import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename } from "node:path";

/** Maximum bytes read from a worker session file in one call. */
export const ACTIVITY_READ_BYTES = 64 * 1024;
/** Maximum rendered activity returned in one call. */
export const ACTIVITY_OUTPUT_BYTES = 20 * 1024;
const EVENT_BYTES = 2 * 1024;
const MAX_EVENTS = 50;

type ContinuityAnchor = {
	readonly position: number;
	readonly length: number;
	readonly hash: string;
};

type ActivityCursor = {
	readonly version: 2;
	readonly worker: string;
	readonly sessionHash: string;
	readonly device: number;
	readonly inode: number;
	readonly observedSize: number;
	readonly offset: number;
	readonly scanOffset: number;
	readonly offsetAnchor: ContinuityAnchor;
	readonly scanAnchor: ContinuityAnchor;
	readonly headerId: string;
};

/** Input for a bounded, repeatable worker activity read. */
export type ReadAgentActivityInput = {
	readonly worker: string;
	readonly cursor?: string;
};

/** One bounded activity page and an opaque continuation cursor. */
export type AgentActivity = {
	readonly worker: string;
	readonly activity: string;
	readonly cursor: string;
	readonly hasMore: boolean;
	readonly incompleteTrailingLine: boolean;
};

/** Expected session activity parsing or cursor failure. */
export class AgentActivityError extends Error {
	/** Stable failure category. */
	readonly code: string;

	/** Creates a safely classified activity reader failure. */
	constructor(code: string, message: string) {
		super(`${code}: ${message}`);
		this.code = code;
	}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	// SAFETY: the runtime object check establishes the string-keyed representation used below.
	return value as Record<string, unknown>;
}

function sessionHash(path: string): string {
	return createHash("sha256").update(path).digest("base64url");
}

function encodeCursor(cursor: ActivityCursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function parseAnchor(value: unknown): ContinuityAnchor | undefined {
	const record = asRecord(value);
	if (!record || typeof record.position !== "number" || !Number.isSafeInteger(record.position) || record.position < 0 ||
		typeof record.length !== "number" || !Number.isSafeInteger(record.length) || record.length < 1 || record.length > 64 ||
		typeof record.hash !== "string" || !record.hash) return undefined;
	return { position: record.position, length: record.length, hash: record.hash };
}

function parseCursor(encoded: string, worker: string, session: string): ActivityCursor {
	let value: unknown;
	try {
		value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
	} catch {
		throw new AgentActivityError("activity_cursor_invalid", "cursor is not valid");
	}
	const record = asRecord(value);
	const offsetAnchor = parseAnchor(record?.offsetAnchor);
	const scanAnchor = parseAnchor(record?.scanAnchor);
	if (
		record?.version !== 2 || record.worker !== worker || record.sessionHash !== sessionHash(session) ||
		typeof record.device !== "number" || !Number.isSafeInteger(record.device) ||
		typeof record.inode !== "number" || !Number.isSafeInteger(record.inode) ||
		typeof record.observedSize !== "number" || !Number.isSafeInteger(record.observedSize) || record.observedSize < 0 ||
		typeof record.offset !== "number" || !Number.isSafeInteger(record.offset) || record.offset < 0 ||
		typeof record.scanOffset !== "number" || !Number.isSafeInteger(record.scanOffset) || record.scanOffset < record.offset ||
		!offsetAnchor || !scanAnchor || typeof record.headerId !== "string" || !record.headerId
	) {
		throw new AgentActivityError("activity_cursor_mismatch", "cursor does not belong to this owned worker session");
	}
	if (offsetAnchor.position + offsetAnchor.length > record.observedSize || scanAnchor.position + scanAnchor.length > record.observedSize) {
		throw new AgentActivityError("activity_cursor_mismatch", "cursor continuity anchors exceed the observed session");
	}
	return {
		version: 2, worker, sessionHash: record.sessionHash, device: record.device, inode: record.inode,
		observedSize: record.observedSize, offset: record.offset, scanOffset: record.scanOffset,
		offsetAnchor, scanAnchor, headerId: record.headerId,
	};
}

async function createAnchor(file: Awaited<ReturnType<typeof open>>, boundary: number, observedEnd: number): Promise<ContinuityAnchor> {
	const position = Math.max(0, boundary - 32);
	const length = Math.min(64, observedEnd - position);
	if (length < 1) throw new AgentActivityError("activity_cursor_invalid", "continuity anchor could not be created");
	const buffer = Buffer.alloc(length);
	const { bytesRead } = await file.read(buffer, 0, length, position);
	if (bytesRead !== length) throw new AgentActivityError("activity_file_changed", "session changed while issuing the activity cursor");
	return { position, length, hash: createHash("sha256").update(buffer).digest("base64url") };
}

async function makeCursor(
	file: Awaited<ReturnType<typeof open>>,
	input: Omit<ActivityCursor, "version" | "offsetAnchor" | "scanAnchor">,
	observedEnd: number,
): Promise<string> {
	const [offsetAnchor, scanAnchor] = await Promise.all([
		createAnchor(file, input.offset, observedEnd),
		createAnchor(file, input.scanOffset, observedEnd),
	]);
	return encodeCursor({ version: 2, ...input, offsetAnchor, scanAnchor });
}

async function verifyAnchor(file: Awaited<ReturnType<typeof open>>, anchor: ContinuityAnchor): Promise<void> {
	const buffer = Buffer.alloc(anchor.length);
	const { bytesRead } = await file.read(buffer, 0, anchor.length, anchor.position);
	const hash = createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("base64url");
	if (bytesRead !== anchor.length || hash !== anchor.hash) {
		throw new AgentActivityError("activity_file_changed", "bounded session continuity check failed");
	}
}

function truncate(value: string, bytes = EVENT_BYTES): string {
	if (Buffer.byteLength(value, "utf8") <= bytes) return value;
	const suffix = "…";
	let result = "";
	for (const character of value) {
		if (Buffer.byteLength(result + character + suffix, "utf8") > bytes) break;
		result += character;
	}
	return result + suffix;
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.flatMap((part) => {
		const record = asRecord(part);
		return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
	}).join("\n");
}

function renderEntry(value: unknown, lineNumber: number): string | undefined {
	const entry = asRecord(value);
	if (!entry) return `[line ${lineNumber} malformed] expected object`;
	const type = typeof entry.type === "string" ? entry.type : "unknown";
	const id = typeof entry.id === "string" ? entry.id : `line-${lineNumber}`;
	const parent = typeof entry.parentId === "string" ? entry.parentId : entry.parentId === null ? "root" : "unknown";
	const prefix = `[${id} ${type} parent=${parent}]`;
	if (type === "message") {
		const message = asRecord(entry.message);
		if (message?.role === "assistant") {
			const rendered: string[] = [];
			if (Array.isArray(message.content)) {
				for (const part of message.content) {
					const block = asRecord(part);
					if (block?.type === "text" && typeof block.text === "string" && block.text) rendered.push(`assistant: ${truncate(block.text)}`);
					if (block?.type === "toolCall" && typeof block.name === "string") {
						const callId = typeof block.id === "string" ? ` ${block.id}` : "";
						rendered.push(`tool call${callId} ${block.name}: ${truncate(JSON.stringify(block.arguments ?? {}))}`);
					}
				}
			}
			if (typeof message.errorMessage === "string" && message.errorMessage) rendered.push(`assistant error: ${truncate(message.errorMessage)}`);
			return rendered.length ? truncate(`[${id} ${type}/assistant parent=${parent}] ${rendered.join("\n")}`) : undefined;
		}
		if (message?.role === "toolResult") {
			const name = typeof message.toolName === "string" ? message.toolName : "unknown";
			const callId = typeof message.toolCallId === "string" ? ` ${message.toolCallId}` : "";
			const marker = message.isError === true ? " error" : "";
			return truncate(`[${id} ${type}/toolResult parent=${parent}] ${name}${callId}${marker}: ${truncate(contentText(message.content) || "(no text output)")}`);
		}
		return undefined;
	}
	if (type === "compaction") return truncate(`${prefix} ${truncate(typeof entry.summary === "string" ? entry.summary : "context compacted")}`);
	if (type === "branch_summary") {
		const from = typeof entry.fromId === "string" ? ` from=${entry.fromId}` : "";
		return truncate(`${prefix.slice(0, -1)}${from}] ${truncate(typeof entry.summary === "string" ? entry.summary : "branch changed")}`);
	}
	return undefined;
}

async function readHeader(file: Awaited<ReturnType<typeof open>>): Promise<{ readonly id: string; readonly bytes: number }> {
	const buffer = Buffer.alloc(16 * 1024);
	const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
	const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
	if (newline < 0) throw new AgentActivityError("activity_header_invalid", "session header is missing or exceeds 16 KB");
	let value: unknown;
	try {
		value = JSON.parse(buffer.subarray(0, newline).toString("utf8")) as unknown;
	} catch {
		throw new AgentActivityError("activity_header_invalid", "session header is malformed");
	}
	const header = asRecord(value);
	if (header?.type !== "session" || typeof header.id !== "string" || !header.id) {
		throw new AgentActivityError("activity_header_invalid", "session header identity is missing");
	}
	return { id: header.id, bytes: newline + 1 };
}

/** Reads an owned Pi JSONL session incrementally without reconstructing conversation state. */
export async function readSessionActivity(
	worker: string,
	session: string,
	cursor?: string,
): Promise<AgentActivity> {
	const file = await open(session, "r").catch(() => {
		throw new AgentActivityError("activity_unavailable", "owned worker session cannot be read");
	});
	try {
		const stats = await file.stat();
		if (!stats.isFile()) throw new AgentActivityError("activity_unavailable", "owned worker session is not a regular file");
		const header = await readHeader(file);
		const filenameIdentity = /^.+_([0-9a-f-]{20,})\.jsonl$/i.exec(basename(session))?.[1];
		if (filenameIdentity && filenameIdentity !== header.id) throw new AgentActivityError("activity_identity_mismatch", "native session and JSONL header do not match");
		const parsed = cursor ? parseCursor(cursor, worker, session) : undefined;
		if (parsed && (parsed.device !== stats.dev || parsed.inode !== stats.ino)) throw new AgentActivityError("activity_file_replaced", "owned worker session file was replaced");
		if (parsed && parsed.headerId !== header.id) throw new AgentActivityError("activity_identity_mismatch", "session header changed since the cursor was issued");
		if (parsed && stats.size < parsed.observedSize) throw new AgentActivityError("activity_file_truncated", "owned worker session became smaller than the cursor observation");
		if (parsed) await Promise.all([verifyAnchor(file, parsed.offsetAnchor), verifyAnchor(file, parsed.scanAnchor)]);
		const offset = parsed?.offset ?? header.bytes;
		const scanOffset = parsed?.scanOffset ?? offset;
		if (offset < header.bytes || scanOffset < offset) throw new AgentActivityError("activity_cursor_mismatch", "cursor is outside session record boundaries");
		if (stats.size < offset || stats.size < scanOffset) throw new AgentActivityError("activity_file_truncated", "owned worker session file was truncated");
		if (offset > header.bytes) {
			const previous = Buffer.alloc(1);
			await file.read(previous, 0, 1, offset - 1);
			if (previous[0] !== 0x0a) throw new AgentActivityError("activity_cursor_mismatch", "cursor offset is not a JSONL record boundary");
		}
		const length = Math.min(ACTIVITY_READ_BYTES, stats.size - scanOffset);
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await file.read(buffer, 0, length, scanOffset);
		const bytes = buffer.subarray(0, bytesRead);
		if (scanOffset > offset) {
			const newline = bytes.indexOf(0x0a);
			if (newline < 0) {
				return {
					worker,
					activity: "(oversized JSONL record is still being scanned within bounded pages)",
					cursor: await makeCursor(file, { worker, sessionHash: sessionHash(session), device: stats.dev, inode: stats.ino, observedSize: stats.size, offset, scanOffset: scanOffset + bytesRead, headerId: header.id }, scanOffset + bytesRead),
					hasMore: scanOffset + bytesRead < stats.size,
					incompleteTrailingLine: scanOffset + bytesRead >= stats.size,
				};
			}
			const nextOffset = scanOffset + newline + 1;
			const marker = truncate(`[oversized-record message parent=unknown] record larger than ${ACTIVITY_READ_BYTES} bytes omitted`);
			return {
				worker,
				activity: marker,
				cursor: await makeCursor(file, { worker, sessionHash: sessionHash(session), device: stats.dev, inode: stats.ino, observedSize: stats.size, offset: nextOffset, scanOffset: nextOffset, headerId: header.id }, scanOffset + bytesRead),
				hasMore: nextOffset < stats.size,
				incompleteTrailingLine: false,
			};
		}
		const events: string[] = [];
		let consumed = 0;
		let lineNumber = 1;
		let outputBytes = 0;
		let stoppedForLimit = false;
		let stoppedForMissingNewline = false;
		while (consumed < bytes.length) {
			if (events.length >= MAX_EVENTS) {
				stoppedForLimit = true;
				break;
			}
			const relativeNewline = bytes.subarray(consumed).indexOf(0x0a);
			if (relativeNewline < 0) {
				stoppedForMissingNewline = true;
				break;
			}
			const end = consumed + relativeNewline;
			const line = bytes.subarray(consumed, end).toString("utf8");
			let rendered: string | undefined;
			try {
				rendered = renderEntry(JSON.parse(line) as unknown, lineNumber);
			} catch {
				rendered = `[line ${lineNumber} malformed] invalid JSON record`;
			}
			if (rendered) {
				rendered = truncate(rendered);
				const separatorBytes = events.length > 0 ? 2 : 0;
				const renderedBytes = Buffer.byteLength(rendered, "utf8");
				if (outputBytes + separatorBytes + renderedBytes > ACTIVITY_OUTPUT_BYTES) {
					stoppedForLimit = true;
					break;
				}
				events.push(rendered);
				outputBytes += separatorBytes + renderedBytes;
			}
			consumed = end + 1;
			lineNumber += 1;
		}
		const nextOffset = offset + consumed;
		const incompleteTrailingLine = stoppedForMissingNewline && offset + bytes.length >= stats.size;
		const nextScanOffset = stoppedForMissingNewline && consumed === 0 && bytes.length === ACTIVITY_READ_BYTES
			? offset + bytes.length
			: nextOffset;
		return {
			worker,
			activity: events.join("\n\n") || "(no assistant/tool activity in this page)",
			cursor: await makeCursor(file, { worker, sessionHash: sessionHash(session), device: stats.dev, inode: stats.ino, observedSize: stats.size, offset: nextOffset, scanOffset: nextScanOffset, headerId: header.id }, scanOffset + bytesRead),
			hasMore: stoppedForLimit || (nextScanOffset < stats.size && !incompleteTrailingLine),
			incompleteTrailingLine,
		};
	} finally {
		await file.close();
	}
}
