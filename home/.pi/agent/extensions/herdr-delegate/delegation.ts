import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, parseFrontmatter, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

import { AgentActivityError, readSessionActivity, type AgentActivity, type ReadAgentActivityInput } from "./activity.ts";

/** Roles available for current delegation and launch configuration. */
export type DelegateRole = "worker" | "scout" | "reviewer";

// Retired builders retain ownership evidence only; never load configuration or reuse them.
type PersistedRole = DelegateRole | "builder";

/** Pi thinking levels accepted in editable role frontmatter. */
export type Thinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Input for a new task, writer follow-up, or explicit replacement with a parent handoff. */
export type DelegateInput = {
	readonly task: string;
	readonly role?: DelegateRole;
	readonly worker?: string;
	/** Requires worker + role: worker + task containing the complete parent handoff. */
	readonly replace?: boolean;
	readonly timeoutMs?: number;
};

/** Cleanup disposition recorded after a correlated task result is captured. */
export type DelegateCleanupOutcome =
	| { readonly status: "retained"; readonly reason: "worker_followups" }
	| { readonly status: "closed" }
	| { readonly status: "failed"; readonly error: string };

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
	readonly cleanup: DelegateCleanupOutcome;
	/** Durable parent handoff saved before the previous owned writer was retired. */
	readonly replacement?: { readonly worker: string; readonly handoffPath: string };
	/** State publication failed; captured output and the actual cleanup disposition remain valid. */
	readonly persistenceError?: string;
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
	readonly role: PersistedRole;
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

type PersistedWorkerDraft = {
	id: string;
	role: PersistedRole;
	agentName: string;
	paneId: string;
	tabId?: string;
	workspaceId?: string;
	session: string;
	roleFingerprint: string;
	promptPath: string;
};

const startupResourceSchema = Type.Object({
	worker: Type.String({ minLength: 1 }), agentName: Type.String({ minLength: 1 }),
	paneId: Type.String({ minLength: 1 }), tabId: Type.String({ minLength: 1 }), workspaceId: Type.String({ minLength: 1 }),
});
type StartupResource = Static<typeof startupResourceSchema>;

type DelegateRuntimeStateDraft = {
	ownerSessionId: string;
	workers: readonly PersistedWorker[];
	pending?: PendingTask;
	unsafeWriter?: string;
	unsafeWriterWorker?: string;
	startupResource?: StartupResource;
	persistenceError?: string;
};

/** Persisted worker authority bound to one parent Pi session. */
export type DelegateRuntimeState = {
	readonly ownerSessionId: string;
	readonly workers: readonly PersistedWorker[];
	readonly pending?: PendingTask;
	readonly unsafeWriter?: string;
	readonly unsafeWriterWorker?: string;
	/** Diagnostic startup provenance only; never native ownership or deletion authority. */
	readonly startupResource?: StartupResource;
	/** Publication recovery is distinct from an unpinned, potentially live startup resource. */
	readonly persistenceError?: string;
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

type ChildResultDraft = {
	taskId: string;
	worker: string;
	status: ChildResult["status"];
	output: string;
	error?: string;
	stopReason?: string;
	session: string;
	provider: string;
	model: string;
	thinking: string;
	finishedAt: number;
};

const roleFrontmatterSchema = Type.Object({
	name: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
	model: Type.Optional(Type.String()),
	thinking: Type.Optional(Type.String()),
	tools: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
});
type RoleFrontmatter = Static<typeof roleFrontmatterSchema>;

const persistedWorkerSchema = Type.Object({
	id: Type.String(), role: Type.String(), agentName: Type.String(), paneId: Type.String(),
	tabId: Type.Optional(Type.String()), workspaceId: Type.Optional(Type.String()), session: Type.String(),
	roleFingerprint: Type.String(), promptPath: Type.String(),
});
const pendingTaskSchema = Type.Object({
	taskId: Type.String({ minLength: 1 }),
	worker: Type.String({ minLength: 1 }),
	resultPath: Type.String({ minLength: 1 }),
	startedAt: Type.Number(),
});
type PersistedStateRepresentation = {
	readonly ownerSessionId: string;
	readonly workers: readonly Static<typeof persistedWorkerSchema>[];
	readonly pending?: Static<typeof pendingTaskSchema> | null;
	readonly unsafeWriter?: string | number | null;
	readonly unsafeWriterWorker?: string | number | null;
	readonly persistenceError?: string | null;
	readonly startupResource?: StartupResource;
};
/** Serialized custom-entry contract checked before runtime-state reconstruction. */
export const delegateRuntimeStateSchema = Type.Object({
	ownerSessionId: Type.String(),
	workers: Type.Array(persistedWorkerSchema),
	pending: Type.Optional(Type.Union([pendingTaskSchema, Type.Null()])),
	unsafeWriter: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()])),
	unsafeWriterWorker: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()])),
	persistenceError: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	startupResource: Type.Optional(startupResourceSchema),
});

const childResultSchema = Type.Object({
	version: Type.Number(), taskId: Type.String(), worker: Type.String(), status: Type.String(), output: Type.String(),
	error: Type.Optional(Type.String()), stopReason: Type.Optional(Type.String()), session: Type.String(),
	provider: Type.String(), model: Type.String(), thinking: Type.String(), finishedAt: Type.Number(),
});

const agentIdentitySchema = Type.Object({
	name: Type.String(), pane_id: Type.String(), agent_status: Type.Optional(Type.String()),
	agent_session: Type.Optional(Type.Union([Type.Object({ value: Type.String() }), Type.Null()])),
});
type AgentIdentity = Static<typeof agentIdentitySchema>;
const agentResponseSchema = Type.Object({ result: Type.Object({ agent: agentIdentitySchema }) });
const paneResponseSchema = Type.Object({
	result: Type.Object({ pane: Type.Object({
		pane_id: Type.String(), tab_id: Type.String(), workspace_id: Type.String(),
		agent: Type.Optional(Type.Unknown()),
	}) }),
});
const paneCreatedResponseSchema = Type.Object({
	result: Type.Object({
		pane: Type.Object({ pane_id: Type.String({ minLength: 1 }), tab_id: Type.String({ minLength: 1 }), workspace_id: Type.String({ minLength: 1 }) }),
	}),
});
const paneLayoutResponseSchema = Type.Object({
	result: Type.Object({ layout: Type.Object({
		tab_id: Type.String(), workspace_id: Type.String(),
		panes: Type.Array(Type.Object({ pane_id: Type.String(), rect: Type.Object({
			width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }),
		}) })),
	}) }),
});
const herdrFailureSchema = Type.Object({ error: Type.Object({ code: Type.String(), message: Type.String() }) });

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
const thinkingSchema = Type.Union([
	Type.Literal("off"), Type.Literal("minimal"), Type.Literal("low"), Type.Literal("medium"),
	Type.Literal("high"), Type.Literal("xhigh"), Type.Literal("max"),
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function ok<T>(value: T): DelegationResult<T> {
	return { ok: true, value };
}

function err<T>(code: string, message: string, cause?: unknown, worker?: string): DelegationResult<T> {
	return { ok: false, error: new DelegationError(code, message, cause, worker) };
}
function parseJson<Schema extends TSchema>(
	text: string,
	operation: string,
	schema: Schema,
): DelegationResult<Static<Schema>> {
	try {
		const value: unknown = JSON.parse(text);
		return Value.Check(schema, value)
			? ok(value)
			: err("invalid_herdr_response", `${operation}: response did not match the expected contract`);
	} catch (cause) {
		return err("invalid_herdr_response", `${operation}: ${text.slice(0, 500)}`, cause);
	}
}
function parseTools(value: RoleFrontmatter["tools"]): readonly string[] | undefined {
	const raw = Value.Check(Type.Array(Type.String()), value) ? value : value?.split(",");
	if (!raw) return undefined;
	const tools = raw.map((tool) => tool.trim()).filter(Boolean);
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
		const parsed = parseFrontmatter<RoleFrontmatter>(source);
		if (!Value.Check(roleFrontmatterSchema, parsed.frontmatter)) {
			return err("role_invalid", `${role}: require name, description, provider/model, thinking, tools, and body`);
		}
		const { frontmatter, body } = parsed;
		const tools = parseTools(frontmatter.tools);
		if (frontmatter.name !== role || !frontmatter.description || !frontmatter.model ||
			!Value.Check(thinkingSchema, frontmatter.thinking) || !tools || !body.trim()) {
			return err("role_invalid", `${role}: require name, description, provider/model, thinking, tools, and body`);
		}
		if (tools.some((tool) => tool === "delegate" || tool === "read_agent_activity")) return err("role_unsafe", `${role}: parent-only delegation tools are forbidden`);
		if ((role === "reviewer" || role === "scout") && tools.some((tool) => tool !== "read" && tool !== "bash")) return err("role_unsafe", `${role}: only read and policy-restricted bash are allowed`);
		const separator = frontmatter.model.indexOf("/");
		if (separator < 1) return err("role_invalid", `${role}: model must be provider/id`);
		const provider = frontmatter.model.slice(0, separator).trim();
		const model = frontmatter.model.slice(separator + 1).trim();
		if (!provider || !model) return err("role_invalid", `${role}: model must be provider/id`);
		return ok({ name: role, description: frontmatter.description, provider, model, thinking: frontmatter.thinking, tools, systemPrompt: body.trim() });
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
export function parseDelegateRuntimeState(
	value: PersistedStateRepresentation,
): DelegationResult<DelegateRuntimeState> {
	if (!value.ownerSessionId) {
		return err("state_invalid", "ownerSessionId or workers missing");
	}
	const workers: PersistedWorker[] = [];
	for (const raw of value.workers) {
		if (!raw.id || (raw.role !== "builder" && raw.role !== "worker" && raw.role !== "scout" && raw.role !== "reviewer") || !raw.agentName || !raw.paneId ||
			!raw.session || !raw.roleFingerprint || !raw.promptPath || (raw.tabId !== undefined && !raw.tabId) ||
			(raw.workspaceId !== undefined && !raw.workspaceId)) return err("state_invalid", "worker fields invalid");
		const parsedWorker: PersistedWorkerDraft = {
			id: raw.id, role: raw.role, agentName: raw.agentName, paneId: raw.paneId,
			session: raw.session, roleFingerprint: raw.roleFingerprint, promptPath: raw.promptPath,
		};
		if (raw.tabId !== undefined) parsedWorker.tabId = raw.tabId;
		if (raw.workspaceId !== undefined) parsedWorker.workspaceId = raw.workspaceId;
		workers.push(parsedWorker);
	}
	if (Object.hasOwn(value, "pending") && !Value.Check(pendingTaskSchema, value.pending)) {
		return err("state_invalid", "pending must be a task object when present");
	}
	const pending = Value.Check(pendingTaskSchema, value.pending) ? value.pending : undefined;
	if (pending && !workers.some((worker) => worker.id === pending.worker)) {
		return err("state_invalid", "pending must identify an owned worker");
	}
	const unsafeWriter = Value.Check(Type.String({ minLength: 1 }), value.unsafeWriter) ? value.unsafeWriter : undefined;
	const unsafeWriterWorker = Value.Check(Type.String({ minLength: 1 }), value.unsafeWriterWorker) ? value.unsafeWriterWorker : undefined;
	if (Object.hasOwn(value, "unsafeWriter") && !unsafeWriter) return err("state_invalid", "unsafeWriter must be a non-empty string when present");
	if (Object.hasOwn(value, "unsafeWriterWorker") &&
		(!unsafeWriter || !unsafeWriterWorker || !workers.some((worker) => worker.id === unsafeWriterWorker))) {
		return err("state_invalid", "unsafeWriterWorker must identify an owned worker when present");
	}
	const persistenceError = Value.Check(Type.String({ minLength: 1 }), value.persistenceError) ? value.persistenceError : undefined;
	if (Object.hasOwn(value, "persistenceError") && !persistenceError) return err("state_invalid", "persistenceError must be a non-empty string when present");
	const state: DelegateRuntimeStateDraft = { ownerSessionId: value.ownerSessionId, workers };
	if (pending) state.pending = pending;
	if (unsafeWriter) state.unsafeWriter = unsafeWriter;
	if (unsafeWriterWorker) state.unsafeWriterWorker = unsafeWriterWorker;
	if (persistenceError) state.persistenceError = persistenceError;
	if (Object.hasOwn(value, "startupResource")) {
		if (!Value.Check(startupResourceSchema, value.startupResource) || !unsafeWriter || unsafeWriterWorker || pending) {
			return err("state_invalid", "startupResource requires unpinned startup authority without a pending task");
		}
		state.startupResource = value.startupResource;
	}
	return ok(state);
}

function parseChildResult(
	value: Static<typeof childResultSchema>,
	pending: PendingTask,
	worker: PersistedWorker,
): DelegationResult<ChildResult> {
	if (value.version !== 1 || value.taskId !== pending.taskId || value.worker !== worker.id ||
		(value.status !== "completed" && value.status !== "failed" && value.status !== "incomplete") ||
		value.session !== worker.session || !value.provider || !value.model || !value.thinking || value.finishedAt < pending.startedAt) {
		return err("result_invalid", "task, native session, or terminal fields did not match");
	}
	const child: ChildResultDraft = {
		taskId: value.taskId, worker: worker.id, status: value.status, output: value.output,
		session: value.session, provider: value.provider, model: value.model, thinking: value.thinking,
		finishedAt: value.finishedAt,
	};
	if (value.error) child.error = value.error;
	if (value.stopReason) child.stopReason = value.stopReason;
	return ok(child);
}

function encodeTask(pending: PendingTask, task: string): string {
	const envelope = Buffer.from(JSON.stringify({ version: 1, taskId: pending.taskId, worker: pending.worker, startedAt: pending.startedAt }), "utf8").toString("base64url");
	return `[[herdr-delegate:v1:${envelope}]]\n${task}`;
}
function cliFailure(result: CommandResult): string {
	if (result.killed) return "command was killed before transport completion";
	const text = result.stderr.trim() || result.stdout.trim();
	try {
		const value: unknown = JSON.parse(text);
		return Value.Check(herdrFailureSchema, value)
			? `${value.error.code}: ${value.error.message}`
			: text || `exit ${result.code}`;
	} catch {
		return text || `exit ${result.code}`;
	}
}
function hasCliError(result: CommandResult, codes: readonly string[]): boolean {
	if (result.killed || result.code === 0) return false;
	try {
		const value: unknown = JSON.parse(result.stderr.trim() || result.stdout.trim());
		return Value.Check(herdrFailureSchema, value) && codes.includes(value.error.code);
	} catch {
		return false;
	}
}
async function readResult(
	path: string,
	deadline: number,
	pending: PendingTask,
	worker: PersistedWorker,
): Promise<DelegationResult<ChildResult>> {
	let cause = new Error("result artifact was not available");
	while (Date.now() <= deadline) {
		try {
			const value: unknown = JSON.parse(await readFile(path, "utf8"));
			return Value.Check(childResultSchema, value)
				? parseChildResult(value, pending, worker)
				: err("result_invalid", "task result did not match the expected contract");
		} catch (error) {
			cause = error instanceof Error ? error : new Error(String(error));
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
	#cleanupDone: Promise<void> = Promise.resolve();
	#suspended = false;
	readonly #activityCalls = new Set<Promise<DelegationResult<AgentActivity>>>();
	#persistenceError: DelegationError | undefined;
	#pending: PendingTask | undefined;
	#unsafeWriter: string | undefined;
	#unsafeWriterWorker: string | undefined;
	#startupResource: StartupResource | undefined;

	/** Creates a runtime from current or persisted parent-session authority. */
	constructor(options: RuntimeOptions) {
		this.#options = options;
		const inherited = options.initialState;
		this.#foreignAuthority = inherited !== undefined && inherited.ownerSessionId !== options.parentSessionId &&
			(inherited.workers.length > 0 || inherited.pending !== undefined || inherited.unsafeWriter !== undefined || inherited.persistenceError !== undefined);
		this.#unrecoverableAuthority = options.initialStateError !== undefined;
		if (inherited?.persistenceError) this.#persistenceError = new DelegationError("state_persist_failed", "restored delegation authority requires persistence recovery", inherited.persistenceError);
		for (const worker of options.initialState?.workers ?? []) this.#workers.set(worker.id, worker);
		this.#startupResource = options.initialState?.startupResource;
		this.#pending = options.initialState?.pending;
		this.#unsafeWriter = options.initialStateError ?? options.initialState?.unsafeWriter ??
			(options.initialState?.pending ? `pending task ${options.initialState.pending.taskId} requires owned-worker cleanup` : undefined);
		this.#unsafeWriterWorker = options.initialState?.unsafeWriterWorker ?? options.initialState?.pending?.worker;
	}

	/** Returns the authority snapshot persisted by the Pi extension. */
	getState(): DelegateRuntimeState {
		const ownerSessionId = this.#foreignAuthority ? this.#options.initialState?.ownerSessionId ?? this.#options.parentSessionId : this.#options.parentSessionId;
		const state: DelegateRuntimeStateDraft = { ownerSessionId, workers: [...this.#workers.values()] };
		if (this.#pending) state.pending = this.#pending;
		if (this.#unsafeWriter) state.unsafeWriter = this.#unsafeWriter;
		if (this.#unsafeWriterWorker) state.unsafeWriterWorker = this.#unsafeWriterWorker;
		if (this.#startupResource && this.#unsafeWriter && !this.#unsafeWriterWorker) state.startupResource = this.#startupResource;
		if (this.#persistenceError) state.persistenceError = this.#persistenceError.message;
		return state;
	}

	/** Shows the exact unpinned startup record eligible for human attestation, not automatic proof. */
	getStartupRecovery(): DelegationResult<string> {
		if (this.#suspended) return err("runtime_closed", "delegation runtime is shutting down");
		if (this.#activeCalls > 0 || this.#cleanupInProgress) return err("cleanup_busy", "delegation or cleanup is active; wait before acknowledging startup recovery");
		if (this.#unrecoverableAuthority) return err("state_corrupt", "corrupt delegation authority cannot be acknowledged");
		if (this.#foreignAuthority) return err("foreign_authority", "another parent session's startup authority cannot be acknowledged");
		if (!this.#unsafeWriter || this.#unsafeWriterWorker || this.#pending || this.#workers.size > 0) {
			return err("startup_recovery_unavailable", "requires only an unpinned startup lock, with no workers or pending task; use ordinary owned cleanup for pinned workers");
		}
		// Legacy text identifies the supported record kind only, never a native identity or deletion target.
		const legacyStartup = ["agent startup failed after creating pane=", "tab creation outcome is uncertain (", "tab creation succeeded but its root pane identity was malformed;", "created tab identity mismatched caller authority (", "pane split outcome is uncertain (", "pane split succeeded but its identity was malformed;", "split pane identity mismatched caller authority ("].some((prefix) => this.#unsafeWriter?.startsWith(prefix)) ||
			(this.#unsafeWriter.startsWith("started delegate-") && ["but native session identity was malformed; inspect and close that pane manually", "without a matching native session identity; inspect and close that pane manually"].some((suffix) => this.#unsafeWriter?.endsWith(suffix)));
		if (!this.#startupResource && !legacyStartup) {
			return err("startup_recovery_unavailable", "this unpinned lock is not a recognized startup record");
		}
		return ok(`${this.#unsafeWriter}${this.#startupResource ? `\nStartup provenance (not native ownership): ${JSON.stringify(this.#startupResource)}` : "\nLegacy record: no structured native identity is available."}`);
	}

	/** Clears only the unchanged displayed startup lock after explicit user attestation; failed publication retains it. */
	acknowledgeStartupRecovery(displayedRecord: string): DelegationResult<void> {
		const current = this.getStartupRecovery();
		if (!current.ok) return current;
		if (current.value !== displayedRecord) return err("startup_recovery_changed", "startup record changed; inspect and confirm it again");
		const unsafeWriter = this.#unsafeWriter;
		const startupResource = this.#startupResource;
		this.#unsafeWriter = undefined;
		this.#startupResource = undefined;
		this.#persistenceError = undefined;
		const published = this.#publish();
		if (!published.ok) {
			this.#unsafeWriter = unsafeWriter;
			this.#startupResource = startupResource;
		}
		return published;
	}

	/** Runs one serialized task and prevents pre-aborted requests from mutating resources. */
	async delegate(input: DelegateInput, signal?: AbortSignal): Promise<DelegationResult<DelegateResult>> {
		if (this.#suspended) return err("runtime_closed", "delegation runtime is shutting down");
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
		if (this.#suspended) return err("runtime_closed", "delegation runtime is shutting down");
		const operation = this.#readAgentActivity(input);
		this.#activityCalls.add(operation);
		try {
			return await operation;
		} finally {
			this.#activityCalls.delete(operation);
		}
	}

	async #readAgentActivity(input: ReadAgentActivityInput): Promise<DelegationResult<AgentActivity>> {
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

	/** Drains accepted mutations and persists their final snapshot before Pi invalidates this instance. */
	async drain(): Promise<DelegationResult<void>> {
		this.#suspended = true;
		await this.#queue;
		await this.#cleanupDone;
		await Promise.all(this.#activityCalls);
		if (this.#foreignAuthority || this.#unrecoverableAuthority) return ok(undefined);
		return this.#publish();
	}

	/** Closes only pinned workers when no delegation call is active. */
	async cleanupOwned(): Promise<DelegationResult<void>> {
		if (this.#activeCalls > 0 || this.#cleanupInProgress) {
			return err("cleanup_busy", "delegation or cleanup is active; wait for it to return before cleanup");
		}
		this.#cleanupInProgress = true;
		let release = (): void => undefined;
		this.#cleanupDone = new Promise<void>((resolve) => { release = resolve; });
		try {
			if (this.#unrecoverableAuthority) {
				return err("state_corrupt", this.#unsafeWriter ?? "persisted delegation authority is corrupt");
			}
			if (this.#foreignAuthority) return err("foreign_authority", `workers belong to parent Pi session ${this.#options.initialState?.ownerSessionId ?? "unknown"}; this session must not control them`);
			const unpinned = this.#unsafeWriter && !this.#unsafeWriterWorker ? this.#unsafeWriter : undefined;
			const failures: string[] = [];
			for (const worker of [...this.#workers.values()]) {
				const closed = await this.#closeOwned(worker);
				if (!closed.ok) {
					failures.push(`Worker ${worker.id}: ${closed.error.message}`);
					if (!unpinned) this.#lock(`cleanup could not safely close ${worker.agentName} (${closed.error.message})`, worker.id);
				}
			}
			if (unpinned) failures.unshift(unpinned);
			if (failures.length) {
				if (this.#persistenceError) failures.push(this.#persistenceError.message);
				return err(unpinned ? "manual_recovery_required" : "cleanup_failed", failures.join("; "));
			}
			if (this.#persistenceError) {
				this.#persistenceError = undefined;
				return this.#publish();
			}
			return ok(undefined);
		} finally {
			this.#cleanupInProgress = false;
			release();
		}
	}

	async #delegate(input: DelegateInput, signal?: AbortSignal): Promise<DelegationResult<DelegateResult>> {
		if (this.#foreignAuthority) return err("foreign_authority", "copied session state cannot adopt another parent session's workers");
		if (this.#persistenceError) return { ok: false, error: this.#persistenceError };
		if (this.#unsafeWriter && !this.#unsafeWriterWorker) {
			return err("manual_recovery_required", `${this.#unsafeWriter}. No pinned worker handle exists; inspect the reported startup resource manually`);
		}
		if (this.#unsafeWriter || this.#pending) {
			const worker = this.#pending?.worker ?? this.#unsafeWriterWorker;
			return err("worker_unresolved", `${this.#unsafeWriter ?? `pending task ${this.#pending?.taskId}`} Use read_agent_activity before /delegate-cleanup if diagnosis is needed.`, undefined, worker);
		}
		const task = input.task.trim();
		if (!task || (input.replace
			? !input.worker || input.role !== "worker"
			: (input.role === undefined) === (input.worker === undefined))) {
			return err("request_invalid", "provide task and exactly one of role or worker; replacement requires replace: true, worker, role: worker, and a complete parent handoff in task");
		}
		const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 3_600_000) return err("request_invalid", "timeoutMs must be 5000..3600000");

		let worker: PersistedWorker;
		let replacement: DelegateResult["replacement"];
		const previous = input.worker ? this.#workers.get(input.worker) : undefined;
		if (input.worker && !previous) return err("worker_unknown", input.worker);
		const roleName = input.replace ? input.role : previous?.role ?? input.role;
		if (roleName === "builder") return err("role_retired", "Builder is retired; explicitly replace with role: worker and a complete parent handoff, or use /delegate-cleanup", undefined, previous?.id);
		if (roleName !== "worker" && roleName !== "scout" && roleName !== "reviewer") return err("request_invalid", "role must be worker, scout, or reviewer");
		if (previous && previous.role !== "builder" && previous.role !== "worker") {
			return err(`${previous.role}_reuse_forbidden`, `delegate to a fresh ${previous.role}`);
		}
		const loaded = await loadRoleConfig(this.#options.rolePaths[roleName], roleName);
		if (!loaded.ok) return loaded;
		const role = loaded.value;
		const valid = await this.#options.validateRole(role, signal);
		if (!valid.ok) return valid;
		if (input.replace && previous) {
			const retired = await this.#replace(previous, role, task, signal);
			if (!retired.ok) return retired;
			replacement = { worker: previous.id, handoffPath: retired.value };
			const started = await this.#start(role, signal);
			if (!started.ok) return err(started.error.code, `${started.error.message}. Preserved handoff: ${retired.value}`, started.error, started.error.worker);
			worker = started.value;
		} else if (input.worker) {
			const existing = this.#workers.get(input.worker);
			if (!existing) return err("worker_unknown", input.worker);
			if (existing.roleFingerprint !== roleFingerprint(role)) return err("role_changed", `${role.name} configuration changed; use explicit replacement with a parent handoff or deliberately clean up before starting a new worker`);
			worker = existing;
			const owned = await this.#owned(worker);
			if (!owned.ok) {
				this.#lock(`writer identity could not be confirmed (${owned.error.message})`, worker.id);
				return err("worker_unresolved", this.#unsafeWriter ?? owned.error.message, owned.error, worker.id);
			}
			const status = owned.value.agent_status;
			if (status !== "idle" && status !== "done") {
				this.#lock(`${worker.agentName} is ${status ?? "unknown"} before prompt`, worker.id);
				return err("worker_unresolved", this.#unsafeWriter ?? "worker not idle", undefined, worker.id);
			}
		} else {
			const started = await this.#start(role, signal);
			if (!started.ok) return started;
			worker = started.value;
		}

		const finished = await this.#runTask(worker, role, task, timeoutMs, signal);
		if (!replacement) return finished;
		return finished.ok ? ok({ ...finished.value, replacement })
			: err(finished.error.code, `${finished.error.message}. Preserved handoff: ${replacement.handoffPath}`, finished.error, finished.error.worker);
	}

	async #runTask(worker: PersistedWorker, role: RoleConfig, task: string, timeoutMs: number, signal?: AbortSignal): Promise<DelegationResult<DelegateResult>> {
		if (signal?.aborted) return err("cancelled", "request aborted before task delivery", undefined, worker.id);
		const taskId = this.#options.id?.() ?? randomUUID();
		if (!SAFE_ID.test(taskId) || !SAFE_ID.test(worker.id)) return err("task_id_invalid", "generated task or worker id is unsafe");
		const pending: PendingTask = { taskId, worker: worker.id, resultPath: join(this.#options.resultRoot, worker.id, `${taskId}.json`), startedAt: this.#options.now?.() ?? Date.now() };
		try {
			await rm(pending.resultPath, { force: true });
		} catch (cause) {
			return err("result_path_unavailable", pending.resultPath, cause);
		}
		this.#pending = pending;
		const persisted = this.#publish();
		if (!persisted.ok) return persisted;
		const promptOptions = signal === undefined ? { timeoutMs: timeoutMs + 5_000 } : { signal, timeoutMs: timeoutMs + 5_000 };
		const prompted = await this.#run(["agent", "prompt", worker.paneId, encodeTask(pending, task), "--wait", "--timeout", String(timeoutMs)], promptOptions);
		if (!prompted.ok || prompted.value.killed || prompted.value.code !== 0) return this.#uncertain(worker, role, pending, prompted.ok ? cliFailure(prompted.value) : prompted.error.message);
		const promptJson = parseJson(prompted.value.stdout, "agent prompt", agentResponseSchema);
		if (!promptJson.ok) return this.#uncertain(worker, role, pending, promptJson.error.message);
		const promptAgent = promptJson.value.result.agent;
		if (promptAgent.name !== worker.agentName || promptAgent.agent_session?.value !== worker.session || promptAgent.agent_status === "blocked") {
			return this.#uncertain(worker, role, pending, "prompt returned blocked or mismatched owner");
		}
		const result = await readResult(pending.resultPath, Date.now() + RESULT_WAIT_MS, pending, worker);
		if (!result.ok) return this.#uncertain(worker, role, pending, result.error.message);
		return this.#finishTerminal(worker, role, pending, result.value);
	}

	async #replace(previous: PersistedWorker, role: RoleConfig, task: string, signal?: AbortSignal): Promise<DelegationResult<string>> {
		if (!SAFE_ID.test(previous.id)) return err("worker_id_invalid", "persisted worker id is unsafe for a handoff path");
		if ([...this.#workers.values()].some((worker) => worker.id !== previous.id && (worker.role === "worker" || worker.role === "builder"))) {
			return err("writer_exists", "another retained writer must be resolved before replacement");
		}
		const handoffId = this.#options.id?.() ?? randomUUID();
		if (!SAFE_ID.test(handoffId)) return err("task_id_invalid", "generated handoff id is unsafe");
		const handoffPath = join(this.#options.resultRoot, previous.id, `replacement-${handoffId}.md`);
		try {
			await mkdir(join(this.#options.resultRoot, previous.id), { recursive: true, mode: 0o700 });
			await writeFile(handoffPath, `# Parent replacement handoff\n\nPrevious worker: ${previous.id}\nSession: ${previous.session}\nSelected role: ${role.name}\nModel: ${role.provider}/${role.model}\nThinking: ${role.thinking}\nFingerprint: ${roleFingerprint(role)}\n\n${task}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
		} catch (cause) {
			return err("handoff_write_failed", "previous writer retained; parent handoff could not be saved", cause, previous.id);
		}
		if (signal?.aborted) return err("cancelled", `replacement cancelled before retirement; handoff: ${handoffPath}`, undefined, previous.id);
		const closed = await this.#closeOwned(previous);
		if (!closed.ok) {
			this.#lock(`replacement could not confirm old writer closure (${closed.error.message}); handoff: ${handoffPath}`, previous.id);
			return err("worker_unresolved", this.#unsafeWriter ?? closed.error.message, closed.error, previous.id);
		}
		if (this.#persistenceError) return err("state_persist_failed", `${this.#persistenceError.message}. Old writer closed; replacement not launched; handoff: ${handoffPath}`, this.#persistenceError);
		if (signal?.aborted) return err("cancelled", `old writer closed; replacement not launched; handoff: ${handoffPath}`);
		return ok(handoffPath);
	}

	async #launchLayout(signal?: AbortSignal): Promise<DelegationResult<{ paneId: string; tabId: string; workspaceId: string; direction: "right" | "down" }>> {
		const options = signal === undefined ? { timeoutMs: 5_000 } : { signal, timeoutMs: 5_000 };
		const current = await this.#run(["pane", "current", "--current"], options);
		if (!current.ok || current.value.killed || current.value.code !== 0) return err("pane_current_failed", current.ok ? cliFailure(current.value) : current.error.message);
		const currentJson = parseJson(current.value.stdout, "pane current", paneCreatedResponseSchema);
		if (!currentJson.ok) return currentJson;
		const caller = currentJson.value.result.pane;
		if (caller.workspace_id !== this.#options.callerWorkspaceId) return err("caller_mismatch", "caller pane is outside the expected workspace");
		const layout = await this.#run(["pane", "layout", "--pane", caller.pane_id], options);
		if (!layout.ok || layout.value.killed || layout.value.code !== 0) return err("pane_layout_failed", layout.ok ? cliFailure(layout.value) : layout.error.message);
		const layoutJson = parseJson(layout.value.stdout, "pane layout", paneLayoutResponseSchema);
		if (!layoutJson.ok) return layoutJson;
		const snapshot = layoutJson.value.result.layout;
		const pane = snapshot.panes.find((entry) => entry.pane_id === caller.pane_id);
		if (!pane || snapshot.tab_id !== caller.tab_id || snapshot.workspace_id !== caller.workspace_id) return err("caller_mismatch", "caller pane layout changed; no split attempted");
		return ok({ paneId: caller.pane_id, tabId: caller.tab_id, workspaceId: caller.workspace_id,
			direction: pane.rect.width >= pane.rect.height * 3 ? "right" : "down" });
	}

	async #start(role: RoleConfig, signal?: AbortSignal): Promise<DelegationResult<PersistedWorker>> {
		if (role.name === "worker") {
			const existing = [...this.#workers.values()].find((worker) => worker.role === "worker" || worker.role === "builder");
			if (existing) return err("writer_exists", "reuse the retained writer or explicitly replace it with a parent handoff", undefined, existing.id);
		}
		if (signal?.aborted) return err("cancelled", "request aborted before launch");
		const location = await this.#launchLayout(signal);
		if (!location.ok) return location;
		const workerId = this.#options.id?.() ?? randomUUID();
		if (!SAFE_ID.test(workerId)) return err("worker_id_invalid", workerId);
		const agentName = `delegate-${role.name}-${workerId.replaceAll("-", "").slice(0, 8)}`;
		const workerDir = join(this.#options.resultRoot, workerId);
		const promptPath = join(workerDir, "role-prompt.md");
		const sessionDir = join(workerDir, "sessions");
		try {
			await mkdir(workerDir, { recursive: true, mode: 0o700 });
			await mkdir(sessionDir, { recursive: true, mode: 0o700 });
			await writeFile(promptPath, `${role.systemPrompt}\n`, { encoding: "utf8", mode: 0o600 });
		} catch (cause) {
			return err("role_prompt_write_failed", promptPath, cause);
		}
		const createOptions = signal === undefined ? { timeoutMs: 10_000 } : { signal, timeoutMs: 10_000 };
		const created = await this.#run(["pane", "split", location.value.paneId, "--direction", location.value.direction, "--cwd", this.#options.cwd,
			"--env", "PI_HERDR_DELEGATE_CHILD=1", "--env", `PI_HERDR_DELEGATE_RESULT_ROOT=${this.#options.resultRoot}`,
			"--env", `PI_HERDR_DELEGATE_WORKER=${workerId}`, "--no-focus"], createOptions);
		if (!created.ok || created.value.killed || created.value.code !== 0) {
			await rm(workerDir, { recursive: true, force: true });
			const failure = created.ok ? cliFailure(created.value) : created.error.message;
			if (!created.ok || created.value.killed) {
				this.#lock(`pane split outcome is uncertain (${failure}); inspect caller tab=${location.value.tabId} for a newly created helper pane`);
				return err("manual_recovery_required", `${this.#unsafeWriter}. No automatic closure was attempted`);
			}
			return err("pane_split_failed", failure);
		}
		const createdJson = parseJson(created.value.stdout, "pane split", paneCreatedResponseSchema);
		if (!createdJson.ok) {
			this.#lock(`pane split succeeded but its identity was malformed; inspect caller tab=${location.value.tabId} for the new helper pane`);
			return err("manual_recovery_required", `${this.#unsafeWriter}. No automatic closure was attempted`);
		}
		const pane = createdJson.value.result.pane;
		const paneId = pane.pane_id;
		const tabId = pane.tab_id;
		const workspaceId = pane.workspace_id;
		if (paneId === location.value.paneId || tabId !== location.value.tabId || workspaceId !== location.value.workspaceId) {
			this.#lock(`split pane identity mismatched caller authority (pane=${paneId}, tab=${tabId}, workspace=${workspaceId}); inspect it manually`);
			return err("manual_recovery_required", `${this.#unsafeWriter}. No automatic closure was attempted`);
		}
		this.#startupResource = { worker: workerId, agentName, paneId, tabId, workspaceId };
		const startArgs = ["agent", "start", agentName, "--kind", "pi", "--pane", paneId, "--timeout", "60000", "--",
			"--model", `${role.provider}/${role.model}`, "--thinking", role.thinking, "--tools", role.tools.join(","), "--name", `delegate ${role.name}`,
			"--session-dir", sessionDir, "--append-system-prompt", promptPath, "--extension", this.#options.reporterPath] as const;
		const startOptions = signal === undefined ? { timeoutMs: 65_000 } : { signal, timeoutMs: 65_000 };
		let start = await this.#run(startArgs, startOptions);
		if (start.ok && !start.value.killed && start.value.code !== 0 && cliFailure(start.value).startsWith("agent_pane_busy:")) {
			const current = await this.#run(["pane", "get", paneId], { timeoutMs: 5_000 });
			const currentJson = current.ok && !current.value.killed && current.value.code === 0
				? parseJson(current.value.stdout, "pane get", paneResponseSchema)
				: undefined;
			const currentPane = currentJson?.ok ? currentJson.value.result.pane : undefined;
			const paneHasNoAgent = currentPane !== undefined && (currentPane.agent === undefined || currentPane.agent === null);
			if (currentPane?.pane_id === paneId && currentPane.tab_id === tabId && currentPane.workspace_id === workspaceId && paneHasNoAgent) {
				start = await this.#run(startArgs, startOptions);
			}
		}
		if (!start.ok || start.value.killed || start.value.code !== 0) {
			const failure = start.ok ? cliFailure(start.value) : start.error.message;
			this.#lock(`agent startup failed after creating pane=${paneId}, tab=${tabId}, workspace=${workspaceId} (${failure}); native session identity was not pinned, so inspect and close that pane manually if appropriate`);
			return err("manual_recovery_required", this.#unsafeWriter ?? failure);
		}
		const startJson = parseJson(start.value.stdout, "agent start", agentResponseSchema);
		if (!startJson.ok) {
			this.#lock(`started ${agentName} in pane=${paneId}, tab=${tabId}, workspace=${workspaceId}, but native session identity was malformed; inspect and close that pane manually`);
			return err("manual_recovery_required", this.#unsafeWriter ?? paneId);
		}
		const agent = startJson.value.result.agent;
		const session = agent.agent_session?.value;
		if (agent.name !== agentName || agent.pane_id !== paneId || !session) {
			this.#lock(`started ${agentName} in pane=${paneId}, tab=${tabId}, workspace=${workspaceId} without a matching native session identity; inspect and close that pane manually`);
			return err("manual_recovery_required", this.#unsafeWriter ?? paneId);
		}
		const worker: PersistedWorker = { id: workerId, role: role.name, agentName, paneId, tabId, workspaceId, session, roleFingerprint: roleFingerprint(role), promptPath };
		this.#startupResource = undefined;
		this.#workers.set(worker.id, worker);
		const persisted = this.#publish(worker.id);
		return persisted.ok ? ok(worker) : persisted;
	}

	async #uncertain(worker: PersistedWorker, role: RoleConfig, pending: PendingTask, reason: string): Promise<DelegationResult<DelegateResult>> {
		const result = await readResult(pending.resultPath, Date.now() + 250, pending, worker);
		if (result.ok) return this.#finishTerminal(worker, role, pending, result.value);
		const owned = await this.#owned(worker);
		if (!owned.ok) {
			this.#lock(`${worker.agentName} task ${pending.taskId} has uncertain delivery (${reason}); native identity could not be confirmed (${owned.error.message})`, worker.id);
			return err("worker_unresolved", `${this.#unsafeWriter}. Prompt was not resubmitted; use read_agent_activity for diagnosis, then /delegate-cleanup for recovery.`, undefined, worker.id);
		}
		await this.#run(["agent", "send-keys", worker.agentName, "esc"], { timeoutMs: 5_000 });
		const closed = await this.#closeOwned(worker);
		if (closed.ok) return err("task_cancelled", `${reason}. Cleanup: matching owned pane closed; prompt was not resubmitted.`);
		this.#lock(`${worker.agentName} task ${pending.taskId} has uncertain delivery (${reason}); cleanup failed (${closed.error.message})`, worker.id);
		return err("worker_unresolved", `${this.#unsafeWriter}. Prompt was not resubmitted; use read_agent_activity for diagnosis, then /delegate-cleanup for recovery.`, undefined, worker.id);
	}

	async #finishTerminal(worker: PersistedWorker, role: RoleConfig, pending: PendingTask, child: ChildResult): Promise<DelegationResult<DelegateResult>> {
		this.#pending = undefined;
		this.#unsafeWriter = undefined;
		this.#unsafeWriterWorker = undefined;
		this.#publish();
		const mismatch = child.provider !== role.provider || child.model !== role.model || child.thinking !== role.thinking;
		const terminalFailure = mismatch || child.status !== "completed";
		let cleanup: DelegateCleanupOutcome = { status: "retained", reason: "worker_followups" };
		if (worker.role === "reviewer" || worker.role === "scout" || terminalFailure) {
			const closed = await this.#closeOwned(worker);
			if (closed.ok) cleanup = { status: "closed" };
			else {
				cleanup = { status: "failed", error: closed.error.message };
				this.#lock(`correlated task ${pending.taskId} cleanup failed (${closed.error.message})`, worker.id);
			}
		}
		const persistenceError = this.#persistenceError?.message;
		const cleanupText = (cleanup.status === "closed" ? "Cleanup: matching owned pane closed."
			: cleanup.status === "failed" ? `Cleanup failed: ${cleanup.error}` : "Cleanup: worker retained for follow-ups until the parent task settles.") +
			(persistenceError ? ` ${persistenceError}. Result artifact: ${pending.resultPath}\n${formatOutput(child, pending.resultPath)}` : "");
		if (mismatch) return err("model_mismatch", `${child.provider}/${child.model} (${child.thinking}). ${cleanupText}`, undefined, cleanup.status === "failed" ? worker.id : undefined);
		if (child.status !== "completed") {
			return err(
				child.status === "incomplete" ? "task_incomplete" : "task_failed",
				`${child.error ?? child.stopReason ?? child.status}. ${cleanupText}`,
				undefined,
				cleanup.status === "failed" ? worker.id : undefined,
			);
		}
		const completed: DelegateResult & { persistenceError?: string } = {
			role: role.name,
			worker: worker.id,
			agentName: worker.agentName,
			paneId: worker.paneId,
			session: worker.session,
			taskId: pending.taskId,
			output: formatOutput(child, pending.resultPath),
			resultPath: pending.resultPath,
			model: `${child.provider}/${child.model}`,
			thinking: child.thinking,
			cleanup,
		};
		if (persistenceError) completed.persistenceError = persistenceError;
		return ok(completed);
	}

	async #closeOwned(worker: PersistedWorker): Promise<DelegationResult<void>> {
		const owned = await this.#owned(worker);
		if (!owned.ok) {
			if (owned.error.code !== "worker_missing") return owned;
			const pane = await this.#run(["pane", "get", worker.paneId], { timeoutMs: 5_000 });
			if (!pane.ok || !hasCliError(pane.value, ["pane_not_found"])) return owned;
		} else {
			const closed = await this.#run(["pane", "close", worker.paneId], { timeoutMs: 5_000 });
			if (!closed.ok || closed.value.killed || closed.value.code !== 0) {
				return err("cleanup_failed", closed.ok ? cliFailure(closed.value) : closed.error.message, undefined, worker.id);
			}
		}
		this.#workers.delete(worker.id);
		if (this.#pending?.worker === worker.id) this.#pending = undefined;
		if (this.#unsafeWriterWorker === worker.id) {
			this.#unsafeWriter = undefined;
			this.#unsafeWriterWorker = undefined;
		}
		this.#publish();
		return ok(undefined);
	}

	async #locatePane(worker: PersistedWorker): Promise<DelegationResult<void>> {
		const current = await this.#run(["pane", "get", worker.paneId], { timeoutMs: 5_000 });
		if (!current.ok || current.value.killed || current.value.code !== 0) return err("worker_unavailable", current.ok ? cliFailure(current.value) : current.error.message, undefined, worker.id);
		const parsed = parseJson(current.value.stdout, "pane get", paneResponseSchema);
		if (!parsed.ok) return parsed;
		const pane = parsed.value.result.pane;
		if (pane.pane_id !== worker.paneId || (worker.tabId !== undefined && pane.tab_id !== worker.tabId) ||
			(worker.workspaceId !== undefined && pane.workspace_id !== worker.workspaceId)) return err("worker_moved", worker.agentName, undefined, worker.id);
		return ok(undefined);
	}

	async #owned(worker: PersistedWorker): Promise<DelegationResult<AgentIdentity>> {
		const current = await this.#run(["agent", "get", worker.agentName], { timeoutMs: 5_000 });
		if (!current.ok || current.value.killed || current.value.code !== 0) {
			const missing = current.ok && hasCliError(current.value, ["agent_not_found", "agent_name_not_found"]);
			return err(missing ? "worker_missing" : "worker_unavailable", current.ok ? cliFailure(current.value) : current.error.message, undefined, worker.id);
		}
		const parsed = parseJson(current.value.stdout, "agent get", agentResponseSchema);
		if (!parsed.ok) return parsed;
		const agent = parsed.value.result.agent;
		if (agent.name !== worker.agentName || agent.pane_id !== worker.paneId || agent.agent_session?.value !== worker.session) return err("worker_replaced", worker.agentName, undefined, worker.id);
		if (worker.tabId !== undefined || worker.workspaceId !== undefined) {
			const located = await this.#locatePane(worker);
			if (!located.ok) return located;
		}
		return ok(agent);
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
	#publish(worker?: string): DelegationResult<void> {
		try {
			this.#options.onStateChange?.(this.getState());
			return ok(undefined);
		} catch (cause) {
			this.#persistenceError = new DelegationError("state_persist_failed", "delegation authority could not be persisted; further delegation is locked until cleanup succeeds", cause, worker ?? this.#pending?.worker ?? this.#unsafeWriterWorker);
			return { ok: false, error: this.#persistenceError };
		}
	}
}
