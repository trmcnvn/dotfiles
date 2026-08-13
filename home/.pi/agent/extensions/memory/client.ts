export type MemoryScope = "global" | "project";
export type MemoryStatus = "active" | "deprecated" | "archived";

export type MemoryRecord = {
	id: string;
	key: string;
	scope: MemoryScope;
	projectId: string | null;
	namespace: string;
	title: string | null;
	content: string;
	tags: string[];
	status: MemoryStatus;
	staleAfter: string | null;
	createdAt: string;
	updatedAt: string;
	version: number;
};

export type MemorySummary = Omit<MemoryRecord, "content"> & { excerpt: string };

export type MemoryPage = {
	records: MemorySummary[];
	nextCursor: string | null;
};

export type MemoryIdentity = {
	key: string;
	scope: MemoryScope;
	projectId?: string;
	namespace?: string;
};

export type WriteMemoryInput = MemoryIdentity & {
	content: string;
	title?: string;
	tags?: string[];
	status?: MemoryStatus;
	staleAfter?: string;
	expectedVersion?: number;
};

export type AppendMemoryInput = WriteMemoryInput & {
	operationId: string;
};

export type DeleteMemoryInput = MemoryIdentity & {
	expectedVersion?: number;
};

export type ListMemoryInput = {
	scope: MemoryScope;
	projectId?: string;
	namespace?: string;
	tags?: string[];
	includeInactive?: boolean;
	limit?: number;
	cursor?: string;
};

export type SearchMemoryInput = Omit<ListMemoryInput, "cursor"> & {
	query: string;
};

export type MemoryClientOptions = {
	baseUrl: string;
	token: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
};

type ApiError = {
	code: string;
	message: string;
	field?: string;
};

const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const VALID_STATUSES = new Set<MemoryStatus>(["active", "deprecated", "archived"]);

export class MemoryServiceError extends Error {
	readonly name = "MemoryServiceError";

	constructor(
		message: string,
		readonly code: string,
		readonly status?: number,
		readonly field?: string,
		options?: ErrorOptions,
	) {
		super(message, options);
	}
}

function normalizeBaseUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new MemoryServiceError("PI_MEMORY_SERVICE_URL is not configured.", "configuration");

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch (cause) {
		throw new MemoryServiceError("PI_MEMORY_SERVICE_URL is not a valid URL.", "configuration", undefined, undefined, { cause });
	}
	if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) {
		throw new MemoryServiceError("PI_MEMORY_SERVICE_URL must use HTTPS unless it points to localhost.", "configuration");
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new MemoryServiceError("PI_MEMORY_SERVICE_URL must not contain credentials, a query, or a fragment.", "configuration");
	}
	url.pathname = url.pathname.replace(/\/+$/u, "");
	return url.toString().replace(/\/$/u, "");
}

function parseMemoryRecord(value: unknown): MemoryRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new MemoryServiceError("The memory service returned an invalid record.", "protocol");
	}
	const record = value as Partial<MemoryRecord>;
	if (
		typeof record.id !== "string" ||
		typeof record.key !== "string" ||
		(record.scope !== "global" && record.scope !== "project") ||
		!(typeof record.projectId === "string" || record.projectId === null) ||
		typeof record.namespace !== "string" ||
		!(typeof record.title === "string" || record.title === null) ||
		typeof record.content !== "string" ||
		!Array.isArray(record.tags) ||
		!record.tags.every((tag) => typeof tag === "string") ||
		!VALID_STATUSES.has(record.status as MemoryStatus) ||
		!(typeof record.staleAfter === "string" || record.staleAfter === null) ||
		typeof record.createdAt !== "string" ||
		typeof record.updatedAt !== "string" ||
		typeof record.version !== "number" ||
		!Number.isSafeInteger(record.version)
	) {
		throw new MemoryServiceError("The memory service returned an invalid record.", "protocol");
	}
	return record as MemoryRecord;
}

function parseMemorySummary(value: unknown): MemorySummary {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new MemoryServiceError("The memory service returned an invalid memory summary.", "protocol");
	}
	const summary = value as Partial<MemorySummary>;
	const record = parseMemoryRecord({ ...summary, content: "" });
	if (typeof summary.excerpt !== "string") {
		throw new MemoryServiceError("The memory service returned an invalid memory summary.", "protocol");
	}
	const { content: _content, ...fields } = record;
	return { ...fields, excerpt: summary.excerpt };
}

function parseMemoryPage(value: unknown): MemoryPage {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new MemoryServiceError("The memory service returned an invalid memory page.", "protocol");
	}
	const page = value as Partial<MemoryPage>;
	if (!Array.isArray(page.records) || !(typeof page.nextCursor === "string" || page.nextCursor === null)) {
		throw new MemoryServiceError("The memory service returned an invalid memory page.", "protocol");
	}
	return { records: page.records.map(parseMemorySummary), nextCursor: page.nextCursor };
}

function parseSearchResults(value: unknown): MemorySummary[] {
	if (!Array.isArray(value)) {
		throw new MemoryServiceError("The memory service returned invalid search results.", "protocol");
	}
	return value.map(parseMemorySummary);
}

function parseDeleteResult(value: unknown): { deleted: boolean } {
	if (typeof value !== "object" || value === null || Array.isArray(value) || (value as { deleted?: unknown }).deleted !== true) {
		throw new MemoryServiceError("The memory service returned an invalid delete result.", "protocol");
	}
	return { deleted: true };
}

async function readBoundedResponse(response: Response): Promise<string> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw new MemoryServiceError("The memory service returned too much data.", "protocol", response.status);
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

function parseApiError(value: unknown): ApiError | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const error = value as Partial<ApiError>;
	if (typeof error.code !== "string" || typeof error.message !== "string") return null;
	if (error.field !== undefined && typeof error.field !== "string") return null;
	return { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) };
}

function unwrapApiResult<T>(payload: unknown, response: Response, parseValue: (value: unknown) => T): T {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
		throw new MemoryServiceError(`The memory service returned HTTP ${response.status} with an invalid response.`, "protocol", response.status);
	}
	const result = payload as { ok?: unknown; value?: unknown; error?: unknown };
	if (result.ok === true) return parseValue(result.value);
	if (result.ok === false) {
		const error = parseApiError(result.error);
		if (error) throw new MemoryServiceError(error.message, error.code, response.status, error.field);
	}
	throw new MemoryServiceError(`The memory service returned HTTP ${response.status} with an invalid response.`, "protocol", response.status);
}

export function createMemoryClient(options: MemoryClientOptions) {
	const baseUrl = normalizeBaseUrl(options.baseUrl);
	const token = options.token.trim();
	if (!token) throw new MemoryServiceError("PI_MEMORY_SERVICE_TOKEN is not configured.", "configuration");
	const requestFetch = options.fetch ?? fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	async function request<T>(path: string, body: unknown, parseValue: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
		const timeout = AbortSignal.timeout(timeoutMs);
		const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
		let response: Response;
		try {
			response = await requestFetch(`${baseUrl}${path}`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
				signal: requestSignal,
			});
		} catch (cause) {
			if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Memory request cancelled.");
			if (timeout.aborted) throw new MemoryServiceError("The memory service request timed out.", "timeout", undefined, undefined, { cause });
			throw new MemoryServiceError("The memory service could not be reached.", "unavailable", undefined, undefined, { cause });
		}

		const text = await readBoundedResponse(response);
		let payload: unknown;
		try {
			payload = JSON.parse(text) as unknown;
		} catch (cause) {
			throw new MemoryServiceError(`The memory service returned HTTP ${response.status} with invalid JSON.`, "protocol", response.status, undefined, { cause });
		}
		return unwrapApiResult(payload, response, parseValue);
	}

	return {
		write(input: WriteMemoryInput, signal?: AbortSignal) {
			return request("/v1/write", input, parseMemoryRecord, signal);
		},
		append(input: AppendMemoryInput, signal?: AbortSignal) {
			return request("/v1/append", input, parseMemoryRecord, signal);
		},
		get(input: MemoryIdentity, signal?: AbortSignal) {
			return request("/v1/get", input, parseMemoryRecord, signal);
		},
		delete(input: DeleteMemoryInput, signal?: AbortSignal) {
			return request("/v1/delete", input, parseDeleteResult, signal);
		},
		list(input: ListMemoryInput, signal?: AbortSignal) {
			return request("/v1/list", input, parseMemoryPage, signal);
		},
		search(input: SearchMemoryInput, signal?: AbortSignal) {
			return request("/v1/search", input, parseSearchResults, signal);
		},
	};
}

export type MemoryClient = ReturnType<typeof createMemoryClient>;
