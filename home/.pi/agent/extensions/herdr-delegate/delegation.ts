import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, parseFrontmatter, truncateHead } from "@earendil-works/pi-coding-agent";

import { AgentActivityError, readSessionActivity, type AgentActivity, type ReadAgentActivityInput } from "./activity.ts";

/** Fixed role names supported by the v1 delegation pipeline. */
export type DelegateRole = "builder" | "reviewer";

/** Pi thinking levels accepted in editable role frontmatter. */
export type Thinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Input for a new role task or a builder follow-up. */
export type DelegateInput = {
	readonly task: string;
	readonly role?: DelegateRole;
	readonly worker?: string;
	readonly timeoutMs?: number;
};

/** Completed task output and pinned worker identity. */
export type DelegateResult = {
	readonly role: DelegateRole;
	readonly worker: string;
	readonly agentName: string;
	readonly paneId: string;
	readonly session: string;
	readonly taskId: string;
	readonly output: string;
	readonly resultPath: string;
	readonly model: string;
	readonly thinking: string;
};

/** Known delegation failure translated to a tool error at the Pi boundary. */
export class DelegationError extends Error {
	/** Stable tag for expected-failure narrowing. */
	readonly _tag = "DelegationError" as const;

	/** Stable machine-readable failure category. */
	readonly code: string;

	/** Opaque owned worker handle available for diagnosis, when one was pinned. */
	readonly worker: string | undefined;

	/** Original boundary failure, when available. */
	override readonly cause: unknown;

	/** Creates a safely classified delegation failure. */
	constructor(code: string, message: string, cause?: unknown, worker?: string) {
		super(`${code}: ${message}${worker ? ` Worker: ${worker}.` : ""}`);
		this.code = code;
		this.worker = worker;
		this.cause = cause;
	}
}

/** Explicit success or known delegation failure. */
export type DelegationResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: DelegationError };

/** Herdr command outcome, including process cancellation evidence. */
export type CommandResult = {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly killed: boolean;
};

/** Adapter for one bounded Herdr CLI operation. */
export type RunHerdr = (
	args: readonly string[],
	options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
) => Promise<CommandResult>;

/** Parsed editable role configuration. */
export type RoleConfig = {
	readonly name: DelegateRole;
	readonly description: string;
	readonly provider: string;
	readonly model: string;
	readonly thinking: Thinking;
	readonly tools: readonly string[];
	readonly systemPrompt: string;
};

type PersistedWorker = {
	readonly id: string;
	readonly role: DelegateRole;
	readonly agentName: string;
	readonly paneId: string;
	readonly tabId?: string;
	readonly workspaceId?: string;
	readonly session: string;
	readonly roleFingerprint: string;
	readonly promptPath: string;
};

type PendingTask = {
	readonly taskId: string;
	readonly worker: string;
	readonly resultPath: string;
	readonly startedAt: number;
};

/** Persisted worker authority bound to one parent Pi session. */
export type DelegateRuntimeState = {
	readonly ownerSessionId: string;
	readonly workers: readonly PersistedWorker[];
	readonly pending?: PendingTask;
	readonly unsafeWriter?: string;
	readonly unsafeWriterWorker?: string;
};

type ChildResult = {
	readonly taskId: string;
	readonly worker: string;
	readonly status: "completed" | "failed" | "incomplete";
	readonly output: string;
	readonly error?: string;
	readonly stopReason?: string;
	readonly session: string;
	readonly provider: string;
	readonly model: string;
	readonly thinking: string;
	readonly finishedAt: number;
};

type RoleFrontmatter = { name?: unknown; description?: unknown; model?: unknown; thinking?: unknown; tools?: unknown };

type RuntimeOptions = {
	readonly runHerdr: RunHerdr;
	readonly validateRole: (role: RoleConfig, signal?: AbortSignal) => Promise<DelegationResult<void>>;
	readonly callerWorkspaceId: string;
	readonly parentSessionId: string;
	readonly cwd: string;
	readonly resultRoot: string;
	readonly reporterPath: string;
	readonly rolePaths: Readonly<Record<DelegateRole, string>>;
	readonly initialState?: DelegateRuntimeState;
	readonly initialStateError?: string;
	readonly onStateChange?: (state: DelegateRuntimeState) => void;
	readonly now?: () => number;
	readonly id?: () => string;
};

const DEFAULT_TIMEOUT_MS = 20 * 60_000;
const RESULT_WAIT_MS = 5_000;
const THINKING_LEVELS = new Set<Thinking>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function ok<T>(value: T): DelegationResult<T> {
	return { ok: true, value };
}

function err<T>(code: string, message: string, cause?: unknown, worker?: string): DelegationResult<T> {
	return { ok: false, error: new DelegationError(code, message, cause, worker) };
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	// SAFETY: the runtime object check establishes the only Record invariant used at this serialized boundary.
	return value as Record<string, unknown>;
}
function objectField(value: unknown, key: string): Record<string, unknown> | undefined {
	return asRecord(asRecord(value)?.[key]);
}
function stringField(value: unknown, key: string): string | undefined {
	const field = asRecord(value)?.[key];
	return typeof field === "string" ? field : undefined;
}
function numberField(value: unknown, key: string): number | undefined {
	const field = asRecord(value)?.[key];
	return typeof field === "number" ? field : undefined;
}
function parseJson(text: string, operation: string): DelegationResult<Record<string, unknown>> {
	try {
		const record = asRecord(JSON.parse(text) as unknown);
		return record ? ok(record) : err("invalid_herdr_response", `${operation}: expected object`);
	} catch (cause) {
		return err("invalid_herdr_response", `${operation}: ${text.slice(0, 500)}`, cause);
	}
}
function parseTools(value: unknown): readonly string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : undefined;
	if (!raw || !raw.every((tool) => typeof tool === "string")) return undefined;
	// SAFETY: every array member was checked immediately above.
	const tools = (raw as string[]).map((tool) => tool.trim()).filter(Boolean);
	return tools.length ? tools : undefined;
}

/** Loads and validates one global role file without applying fallback values. */
export async function loadRoleConfig(path: string, role: DelegateRole): Promise<DelegationResult<RoleConfig>> {
	let source: string;
	try {
		source = await readFile(path, "utf8");
	} catch (cause) {
		return err("role_unreadable", `${role}: ${cause instanceof Error ? cause.message : String(cause)}`, cause);
	}
	try {
		const { frontmatter, body } = parseFrontmatter<RoleFrontmatter>(source);
		const tools = parseTools(frontmatter.tools);
		if (frontmatter.name !== role || typeof frontmatter.description !== "string" ||
			typeof frontmatter.model !== "string" || typeof frontmatter.thinking !== "string" ||
			!THINKING_LEVELS.has(frontmatter.thinking as Thinking) || !tools || !body.trim()) {
			return err("role_invalid", `${role}: require name, description, provider/model, thinking, tools, and body`);
		}
		if (tools.some((tool) => tool === "delegate" || tool === "read_agent_activity")) return err("role_unsafe", `${role}: parent-only delegation tools are forbidden`);
		if (role === "reviewer" && tools.some((tool) => tool === "edit" || tool === "write")) return err("role_unsafe", "reviewer write tools are forbidden");
		const separator = frontmatter.model.indexOf("/");
		if (separator < 1) return err("role_invalid", `${role}: model must be provider/id`);
		const provider = frontmatter.model.slice(0, separator).trim();
		const model = frontmatter.model.slice(separator + 1).trim();
		if (!provider || !model) return err("role_invalid", `${role}: model must be provider/id`);
		// SAFETY: THINKING_LEVELS membership established the closed union.
		const thinking = frontmatter.thinking as Thinking;
		return ok({ name: role, description: frontmatter.description, provider, model, thinking, tools, systemPrompt: body.trim() });
	} catch (cause) {
		return err("role_invalid", `${role}: malformed frontmatter`, cause);
	}
}

/** Computes the launch-configuration identity required for safe follow-ups. */
export function roleFingerprint(role: RoleConfig): string {
	return createHash("sha256").update(JSON.stringify({
		name: role.name, description: role.description, provider: role.provider, model: role.model,
		thinking: role.thinking, tools: role.tools, systemPrompt: role.systemPrompt,
	})).digest("hex");
}

/** Parses persisted authority without treating malformed optional safety fields as absent. */
export function parseDelegateRuntimeState(value: unknown): DelegationResult<DelegateRuntimeState> {
	const record = asRecord(value);
	const ownerSessionId = stringField(record, "ownerSessionId");
	const rawWorkers = record?.workers;
	if (!record || !ownerSessionId || !Array.isArray(rawWorkers)) {
		return err("state_invalid", "ownerSessionId or workers missing");
	}
	const workers: PersistedWorker[] = [];
	for (const raw of rawWorkers) {
		const id = stringField(raw, "id");
		const role = stringField(raw, "role");
		const agentName = stringField(raw, "agentName");
		const paneId = stringField(raw, "paneId");
		const tabIdPresent = Object.hasOwn(asRecord(raw) ?? {}, "tabId");
		const workspaceIdPresent = Object.hasOwn(asRecord(raw) ?? {}, "workspaceId");
		const tabId = stringField(raw, "tabId");
		const workspaceId = stringField(raw, "workspaceId");
		const session = stringField(raw, "session");
		const roleFingerprintValue = stringField(raw, "roleFingerprint");
		const promptPath = stringField(raw, "promptPath");
		if (!id || (role !== "builder" && role !== "reviewer") || !agentName || !paneId || !session || !roleFingerprintValue || !promptPath ||
			(tabIdPresent && !tabId) || (workspaceIdPresent && !workspaceId)) return err("state_invalid", "worker fields invalid");
		workers.push({ id, role, agentName, paneId, ...(tabId ? { tabId } : {}), ...(workspaceId ? { workspaceId } : {}), session, roleFingerprint: roleFingerprintValue, promptPath });
	}
	const pendingPresent = Object.hasOwn(record, "pending");
	const rawPending = objectField(record, "pending");
	if (pendingPresent && !rawPending) {
		return err("state_invalid", "pending must be a task object when present");
	}
	let pending: PendingTask | undefined;
	if (rawPending) {
		const taskId = stringField(rawPending, "taskId");
		const worker = stringField(rawPending, "worker");
		const resultPath = stringField(rawPending, "resultPath");
		const startedAt = numberField(rawPending, "startedAt");
		if (!taskId || !worker || !resultPath || startedAt === undefined) return err("state_invalid", "pending fields invalid");
		pending = { taskId, worker, resultPath, startedAt };
	}
	const unsafeWriterPresent = Object.hasOwn(record, "unsafeWriter");
	const unsafeWriter = stringField(record, "unsafeWriter");
	const unsafeWriterWorkerPresent = Object.hasOwn(record, "unsafeWriterWorker");
	const unsafeWriterWorker = stringField(record, "unsafeWriterWorker");
	if (unsafeWriterPresent && !unsafeWriter) return err("state_invalid", "unsafeWriter must be a non-empty string when present");
	if (unsafeWriterWorkerPresent && (!unsafeWriter || !unsafeWriterWorker || !workers.some((worker) => worker.id === unsafeWriterWorker))) {
		return err("state_invalid", "unsafeWriterWorker must identify an owned worker when present");
	}
	return ok({
		ownerSessionId,
		workers,
		...(pending ? { pending } : {}),
		...(unsafeWriter ? { unsafeWriter } : {}),
		...(unsafeWriterWorker ? { unsafeWriterWorker } : {}),
	});
}

function parseChildResult(value: unknown, pending: PendingTask, worker: PersistedWorker): DelegationResult<ChildResult> {
	const status = stringField(value, "status");
	const taskId = stringField(value, "taskId");
	const resultWorker = stringField(value, "worker");
	const output = stringField(value, "output");
	const session = stringField(value, "session");
	const provider = stringField(value, "provider");
	const model = stringField(value, "model");
	const thinking = stringField(value, "thinking");
	const finishedAt = numberField(value, "finishedAt");
	if (numberField(value, "version") !== 1 || taskId !== pending.taskId || resultWorker !== worker.id ||
		(status !== "completed" && status !== "failed" && status !== "incomplete") || output === undefined ||
		session !== worker.session || !provider || !model || !thinking || finishedAt === undefined || finishedAt < pending.startedAt) {
		return err("result_invalid", "task, native session, or terminal fields did not match");
	}
	const error = stringField(value, "error");
	const stopReason = stringField(value, "stopReason");
	return ok({ taskId, worker: worker.id, status, output, ...(error ? { error } : {}), ...(stopReason ? { stopReason } : {}), session, provider, model, thinking, finishedAt });
}

function encodeTask(pending: PendingTask, task: string): string {
	const envelope = Buffer.from(JSON.stringify({ version: 1, taskId: pending.taskId, worker: pending.worker, startedAt: pending.startedAt }), "utf8").toString("base64url");
	return `[[herdr-delegate:v1:${envelope}]]\n${task}`;
}
function cliFailure(result: CommandResult): string {
	if (result.killed) return "command was killed before transport completion";
	const text = result.stderr.trim() || result.stdout.trim();
	try {
		const error = objectField(JSON.parse(text) as unknown, "error");
		return `${stringField(error, "code") ?? "herdr_error"}: ${stringField(error, "message") ?? text}`;
	} catch {
		return text || `exit ${result.code}`;
	}
}
async function readResult(path: string, deadline: number): Promise<DelegationResult<unknown>> {
	let cause: unknown;
	while (Date.now() <= deadline) {
		try {
			return ok(JSON.parse(await readFile(path, "utf8")) as unknown);
		} catch (error) {
			cause = error;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
	return err("result_missing", path, cause);
}
function formatOutput(result: ChildResult, path: string): string {
	const truncated = truncateHead(result.output || "(no text output)", { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
	return truncated.truncated ? `${truncated.content}\n\n[Output truncated. Complete task result: ${path}]` : truncated.content;
}

/** Serializes delegation and owns lifecycle authority for pinned Herdr workers. */
export class DelegateRuntime {
	readonly #workers = new Map<string, PersistedWorker>();
	readonly #options: RuntimeOptions;
	readonly #foreignAuthority: boolean;
	readonly #unrecoverableAuthority: boolean;
	#queue: Promise<void> = Promise.resolve();
	#activeCalls = 0;
	#cleanupInProgress = false;
	#pending: PendingTask | undefined;
	#unsafeWriter: string | undefined;
	#unsafeWriterWorker: string | undefined;

	/** Creates a runtime from current or persisted parent-session authority. */
	constructor(options: RuntimeOptions) {
		this.#options = options;
		this.#foreignAuthority = options.initialState !== undefined && options.initialState.ownerSessionId !== options.parentSessionId;
		this.#unrecoverableAuthority = options.initialStateError !== undefined;
		for (const worker of options.initialState?.workers ?? []) this.#workers.set(worker.id, worker);
		this.#pending = options.initialState?.pending;
		this.#unsafeWriter = options.initialStateError ?? options.initialState?.unsafeWriter ??
			(options.initialState?.pending ? `pending task ${options.initialState.pending.taskId} requires owned-worker cleanup` : undefined);
		this.#unsafeWriterWorker = options.initialState?.unsafeWriterWorker ?? options.initialState?.pending?.worker;
	}

	/** Returns the authority snapshot persisted by the Pi extension. */
	getState(): DelegateRuntimeState {
		const ownerSessionId = this.#foreignAuthority ? this.#options.initialState?.ownerSessionId ?? this.#options.parentSessionId : this.#options.parentSessionId;
		return { ownerSessionId, workers: [...this.#workers.values()], ...(this.#pending ? { pending: this.#pending } : {}), ...(this.#unsafeWriter ? { unsafeWriter: this.#unsafeWriter } : {}), ...(this.#unsafeWriterWorker ? { unsafeWriterWorker: this.#unsafeWriterWorker } : {}) };
	}

	/** Runs one serialized task and prevents pre-aborted requests from mutating resources. */
	async delegate(input: DelegateInput, signal?: AbortSignal): Promise<DelegationResult<DelegateResult>> {
		if (signal?.aborted) return err("cancelled", "request was already aborted; no action taken");
		if (this.#cleanupInProgress) return err("cleanup_busy", "delegation cleanup is in progress");
		this.#activeCalls += 1;
		const previous = this.#queue;
		let release = (): void => undefined;
		this.#queue = new Promise<void>((resolve) => { release = resolve; });
		await previous;
		try {
			if (signal?.aborted) {
				return err("cancelled", "request aborted while queued; no action taken");
			}
			return await this.#delegate(input, signal);
		} catch (cause) {
			return err("adapter_failure", cause instanceof Error ? cause.message : String(cause), cause);
		} finally {
			this.#activeCalls -= 1;
			release();
		}
	}

	/** Reads bounded JSONL activity only after confirming a pinned native worker identity. */
	async readAgentActivity(input: ReadAgentActivityInput): Promise<DelegationResult<AgentActivity>> {
		if (this.#foreignAuthority) return err("foreign_authority", "copied session state cannot inspect another parent session's workers");
		const worker = this.#workers.get(input.worker);
		if (!worker) return err("worker_unknown", input.worker);
		const owned = await this.#owned(worker);
		if (!owned.ok) return owned;
		try {
			return ok(await readSessionActivity(worker.id, worker.session, input.cursor));
		} catch (cause) {
			return err(
				cause instanceof AgentActivityError ? cause.code : "activity_read_failed",
				cause instanceof AgentActivityError ? cause.message.slice(cause.message.indexOf(":") + 2) : "owned worker activity could not be read",
				cause,
				worker.id,
			);
		}
	}

	/** Closes only pinned workers when no delegation call is active. */
	async cleanupOwned(): Promise<DelegationResult<void>> {
		if (this.#activeCalls > 0 || this.#cleanupInProgress) {
			return err("cleanup_busy", "delegation or cleanup is active; wait for it to return before cleanup");
		}
		this.#cleanupInProgress = true;
		try {
			if (this.#unrecoverableAuthority) {
				return err("state_corrupt", this.#unsafeWriter ?? "persisted delegation authority is corrupt");
			}
			if (this.#foreignAuthority) return err("foreign_authority", `workers belong to parent Pi session ${this.#options.initialState?.ownerSessionId ?? "unknown"}; this session must not control them`);
			for (const worker of [...this.#workers.values()]) {
				const owned = await this.#owned(worker);
				if (!owned.ok) return owned;
				const closed = await this.#run(["pane", "close", worker.paneId], { timeoutMs: 5_000 });
				if (!closed.ok || closed.value.killed || closed.value.code !== 0) return err("cleanup_failed", closed.ok ? cliFailure(closed.value) : closed.error.message);
				this.#workers.delete(worker.id);
				if (this.#pending?.worker === worker.id) this.#pending = undefined;
				if (this.#unsafeWriterWorker === worker.id) {
					this.#unsafeWriter = undefined;
					this.#unsafeWriterWorker = undefined;
				}
				this.#publish();
			}
			this.#pending = undefined;
			this.#unsafeWriter = undefined;
			this.#unsafeWriterWorker = undefined;
			this.#publish();
			return ok(undefined);
		} finally {
			this.#cleanupInProgress = false;
		}
	}

	async #delegate(input: DelegateInput, signal?: AbortSignal): Promise<DelegationResult<DelegateResult>> {
		if (this.#foreignAuthority) return err("foreign_authority", "copied session state cannot adopt another parent session's workers");
		if (this.#unsafeWriter || this.#pending) {
			const worker = this.#pending?.worker ?? this.#unsafeWriterWorker;
			return err("worker_unresolved", `${this.#unsafeWriter ?? `pending task ${this.#pending?.taskId}`} Use read_agent_activity before /delegate-cleanup if diagnosis is needed.`, undefined, worker);
		}
		const task = input.task.trim();
		if (!task || ((input.role === undefined) === (input.worker === undefined))) return err("request_invalid", "provide task and exactly one of role or worker");
		const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 3_600_000) return err("request_invalid", "timeoutMs must be 5000..3600000");

		let worker: PersistedWorker;
		const roleName = input.worker ? this.#workers.get(input.worker)?.role : input.role;
		if (!roleName) return err("worker_unknown", input.worker ?? "role missing");
		if (input.worker && roleName !== "builder") return err("reviewer_reuse_forbidden", "delegate to a fresh reviewer");
		const loaded = await loadRoleConfig(this.#options.rolePaths[roleName], roleName);
		if (!loaded.ok) return loaded;
		const role = loaded.value;
		const valid = await this.#options.validateRole(role, signal);
		if (!valid.ok) return valid;
		if (input.worker) {
			const existing = this.#workers.get(input.worker);
			if (!existing) return err("worker_unknown", input.worker);
			if (existing.roleFingerprint !== roleFingerprint(role)) return err("role_changed", `${role.name} configuration changed; start a new worker`);
			worker = existing;
			const owned = await this.#owned(worker);
			if (!owned.ok) return owned;
			const status = stringField(owned.value, "agent_status");
			if (status !== "idle" && status !== "done") {
				this.#lock(`${worker.agentName} is ${status ?? "unknown"} before prompt`, worker.id);
				return err("worker_unresolved", this.#unsafeWriter ?? "worker not idle", undefined, worker.id);
			}
		} else {
			const started = await this.#start(role, signal);
			if (!started.ok) return started;
			worker = started.value;
		}

		const taskId = this.#options.id?.() ?? randomUUID();
		if (!SAFE_ID.test(taskId) || !SAFE_ID.test(worker.id)) return err("task_id_invalid", "generated task or worker id is unsafe");
		const pending: PendingTask = { taskId, worker: worker.id, resultPath: join(this.#options.resultRoot, worker.id, `${taskId}.json`), startedAt: this.#options.now?.() ?? Date.now() };
		try {
			await rm(pending.resultPath, { force: true });
		} catch (cause) {
			return err("result_path_unavailable", pending.resultPath, cause);
		}
		this.#pending = pending;
		this.#publish();
		const prompted = await this.#run(["agent", "prompt", worker.paneId, encodeTask(pending, task), "--wait", "--timeout", String(timeoutMs)], {
			...(signal ? { signal } : {}), timeoutMs: timeoutMs + 5_000,
		});
		if (!prompted.ok || prompted.value.killed || prompted.value.code !== 0) return this.#uncertain(worker, role, pending, prompted.ok ? cliFailure(prompted.value) : prompted.error.message);
		const promptJson = parseJson(prompted.value.stdout, "agent prompt");
		if (!promptJson.ok) return this.#uncertain(worker, role, pending, promptJson.error.message);
		const promptAgent = objectField(objectField(promptJson.value, "result"), "agent");
		if (stringField(promptAgent, "name") !== worker.agentName || stringField(objectField(promptAgent, "agent_session"), "value") !== worker.session || stringField(promptAgent, "agent_status") === "blocked") {
			return this.#uncertain(worker, role, pending, "prompt returned blocked or mismatched owner");
		}
		const raw = await readResult(pending.resultPath, Date.now() + RESULT_WAIT_MS);
		if (!raw.ok) return this.#uncertain(worker, role, pending, raw.error.message);
		const parsed = parseChildResult(raw.value, pending, worker);
		if (!parsed.ok) return this.#uncertain(worker, role, pending, parsed.error.message);
		return this.#finishTerminal(worker, role, pending, parsed.value);
	}

	async #start(role: RoleConfig, signal?: AbortSignal): Promise<DelegationResult<PersistedWorker>> {
		const workerId = this.#options.id?.() ?? randomUUID();
		if (!SAFE_ID.test(workerId)) return err("worker_id_invalid", workerId);
		const agentName = `delegate-${role.name}-${workerId.replaceAll("-", "").slice(0, 8)}`;
		const workerDir = join(this.#options.resultRoot, workerId);
		const promptPath = join(workerDir, "role-prompt.md");
		try {
			await mkdir(workerDir, { recursive: true, mode: 0o700 });
			await writeFile(promptPath, `${role.systemPrompt}\n`, { encoding: "utf8", mode: 0o600 });
		} catch (cause) {
			return err("role_prompt_write_failed", promptPath, cause);
		}
		const created = await this.#run(["tab", "create", "--workspace", this.#options.callerWorkspaceId, "--cwd", this.#options.cwd,
			"--label", `delegate ${role.name}`, "--env", "PI_HERDR_DELEGATE_CHILD=1", "--env", `PI_HERDR_DELEGATE_RESULT_ROOT=${this.#options.resultRoot}`,
			"--env", `PI_HERDR_DELEGATE_WORKER=${workerId}`, "--no-focus"], { ...(signal ? { signal } : {}), timeoutMs: 10_000 });
		if (!created.ok || created.value.killed || created.value.code !== 0) {
			await rm(workerDir, { recursive: true, force: true });
			return err("tab_create_failed", created.ok ? cliFailure(created.value) : created.error.message);
		}
		const createdJson = parseJson(created.value.stdout, "tab create");
		if (!createdJson.ok) return createdJson;
		const createdResult = objectField(createdJson.value, "result");
		const pane = objectField(createdResult, "root_pane");
		const tab = objectField(createdResult, "tab");
		const paneId = stringField(pane, "pane_id");
		const tabId = stringField(tab, "tab_id");
		const workspaceId = stringField(tab, "workspace_id");
		if (!paneId || !tabId || workspaceId !== this.#options.callerWorkspaceId || stringField(pane, "tab_id") !== tabId || stringField(pane, "workspace_id") !== workspaceId) {
			return err("invalid_herdr_response", "created tab identity is missing or mismatched");
		}
		const startArgs = ["agent", "start", agentName, "--kind", "pi", "--pane", paneId, "--timeout", "60000", "--",
			"--model", `${role.provider}/${role.model}`, "--thinking", role.thinking, "--tools", role.tools.join(","), "--name", `delegate ${role.name}`,
			"--append-system-prompt", promptPath, "--extension", this.#options.reporterPath] as const;
		let start = await this.#run(startArgs, { ...(signal ? { signal } : {}), timeoutMs: 65_000 });
		if (start.ok && !start.value.killed && start.value.code !== 0 && cliFailure(start.value).startsWith("agent_pane_busy:")) {
			const current = await this.#run(["pane", "get", paneId], { timeoutMs: 5_000 });
			const currentJson = current.ok && !current.value.killed && current.value.code === 0 ? parseJson(current.value.stdout, "pane get") : undefined;
			const currentPane = currentJson?.ok ? objectField(objectField(currentJson.value, "result"), "pane") : undefined;
			const paneHasNoAgent = currentPane !== undefined && (currentPane.agent === undefined || currentPane.agent === null);
			if (stringField(currentPane, "pane_id") === paneId && stringField(currentPane, "tab_id") === tabId && stringField(currentPane, "workspace_id") === workspaceId && paneHasNoAgent) {
				start = await this.#run(startArgs, { ...(signal ? { signal } : {}), timeoutMs: 65_000 });
			}
		}
		if (!start.ok || start.value.killed || start.value.code !== 0) return err("agent_start_failed", `${start.ok ? cliFailure(start.value) : start.error.message}; pane=${paneId}; inspect and close manually if appropriate`);
		const startJson = parseJson(start.value.stdout, "agent start");
		if (!startJson.ok) {
			this.#lock(`started ${agentName} in ${paneId} but launch identity was malformed`);
			return err("worker_unresolved", this.#unsafeWriter ?? paneId);
		}
		const agent = objectField(objectField(startJson.value, "result"), "agent");
		const session = stringField(objectField(agent, "agent_session"), "value");
		if (stringField(agent, "name") !== agentName || stringField(agent, "pane_id") !== paneId || !session) {
			this.#lock(`started ${agentName} in ${paneId} without a native session identity; inspect and close manually`);
			return err("worker_unresolved", this.#unsafeWriter ?? paneId);
		}
		const worker: PersistedWorker = { id: workerId, role: role.name, agentName, paneId, tabId, workspaceId, session, roleFingerprint: roleFingerprint(role), promptPath };
		this.#workers.set(worker.id, worker);
		this.#publish();
		return ok(worker);
	}

	async #uncertain(worker: PersistedWorker, role: RoleConfig, pending: PendingTask, reason: string): Promise<DelegationResult<DelegateResult>> {
		const raw = await readResult(pending.resultPath, Date.now() + 250);
		if (raw.ok) {
			const parsed = parseChildResult(raw.value, pending, worker);
			if (parsed.ok) return this.#finishTerminal(worker, role, pending, parsed.value);
		}
		const owned = await this.#owned(worker);
		if (owned.ok) await this.#run(["agent", "send-keys", worker.agentName, "esc"], { timeoutMs: 5_000 });
		this.#lock(`${worker.agentName} task ${pending.taskId} has uncertain delivery (${reason}); prompt was not resubmitted`, worker.id);
		return err("worker_unresolved", `${this.#unsafeWriter}. Use read_agent_activity for diagnosis, then run /delegate-cleanup to close the pinned session.`, undefined, worker.id);
	}

	#finishTerminal(worker: PersistedWorker, role: RoleConfig, pending: PendingTask, child: ChildResult): DelegationResult<DelegateResult> {
		this.#pending = undefined;
		this.#unsafeWriter = undefined;
		this.#unsafeWriterWorker = undefined;
		this.#publish();
		if (child.provider !== role.provider || child.model !== role.model || child.thinking !== role.thinking) {
			return err("model_mismatch", `${child.provider}/${child.model} (${child.thinking})`);
		}
		if (child.status !== "completed") {
			return err(
				child.status === "incomplete" ? "task_incomplete" : "task_failed",
				child.error ?? child.stopReason ?? child.status,
			);
		}
		return ok({
			role: worker.role,
			worker: worker.id,
			agentName: worker.agentName,
			paneId: worker.paneId,
			session: worker.session,
			taskId: pending.taskId,
			output: formatOutput(child, pending.resultPath),
			resultPath: pending.resultPath,
			model: `${child.provider}/${child.model}`,
			thinking: child.thinking,
		});
	}

	async #owned(worker: PersistedWorker): Promise<DelegationResult<Record<string, unknown>>> {
		const current = await this.#run(["agent", "get", worker.agentName], { timeoutMs: 5_000 });
		if (!current.ok || current.value.killed || current.value.code !== 0) return err("worker_unavailable", current.ok ? cliFailure(current.value) : current.error.message);
		const parsed = parseJson(current.value.stdout, "agent get");
		if (!parsed.ok) return parsed;
		const agent = objectField(objectField(parsed.value, "result"), "agent");
		if (stringField(agent, "name") !== worker.agentName || stringField(agent, "pane_id") !== worker.paneId || stringField(objectField(agent, "agent_session"), "value") !== worker.session) return err("worker_replaced", worker.agentName);
		return ok(agent ?? {});
	}
	async #run(args: readonly string[], options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number }): Promise<DelegationResult<CommandResult>> {
		try {
			return ok(await this.#options.runHerdr(args, options));
		} catch (cause) {
			return err("herdr_command_failed", args.slice(0, 3).join(" "), cause);
		}
	}
	#lock(message: string, worker?: string): void {
		this.#unsafeWriter = message;
		this.#unsafeWriterWorker = worker;
		this.#publish();
	}
	#publish(): void {
		this.#options.onStateChange?.(this.getState());
	}
}
