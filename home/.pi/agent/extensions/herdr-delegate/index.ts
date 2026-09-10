import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getSupportedThinkingLevels, StringEnum } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { formatSkillsForPrompt, getAgentDir, type BeforeAgentStartEvent, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import {
	DelegateRuntime,
	DelegationError,
	delegateRuntimeStateSchema,
	loadRoleConfig,
	parseDelegateRuntimeState,
	type DelegateRuntimeState,
	type DelegationResult,
	type RoleConfig,
} from "./delegation.ts";

const CHILD_ENV = "PI_HERDR_DELEGATE_CHILD";
const RESULT_ROOT_ENV = "PI_HERDR_DELEGATE_RESULT_ROOT";
const WORKER_ENV = "PI_HERDR_DELEGATE_WORKER";
const STATE_ENTRY = "herdr-delegate-state";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const TASK_PREFIX = /^\[\[herdr-delegate:v1:([A-Za-z0-9_-]+)\]\]\n([\s\S]*)$/;

function isInsideHerdr(): boolean {
	return process.env.HERDR_ENV === "1" && Boolean(process.env.HERDR_PANE_ID) && Boolean(process.env.HERDR_WORKSPACE_ID);
}

type ActiveTask = {
	readonly taskId: string;
	readonly worker: string;
	readonly startedAt: number;
};

const activeTaskSchema = Type.Object({
	version: Type.Literal(1),
	taskId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" }),
	worker: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" }),
	startedAt: Type.Number(),
});

type ChildResultArtifact = {
	readonly version: 1;
	readonly taskId: string;
	readonly worker: string;
	readonly status: "completed" | "failed" | "incomplete";
	readonly output: string;
	error?: string;
	stopReason?: string;
	readonly session: string;
	readonly provider: string;
	readonly model: string;
	readonly thinking: string;
	readonly finishedAt: number;
};

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter(
			(part): part is Extract<AssistantMessage["content"][number], { type: "text" }> =>
				part.type === "text",
		)
		.map((part) => part.text)
		.join("\n");
}
function latestAssistant(ctx: ExtensionContext, startedAt: number): AssistantMessage | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type === "message" && entry.message.role === "assistant" && entry.message.timestamp >= startedAt) return entry.message;
	}
	return undefined;
}
async function writeJsonAtomic(path: string, value: ChildResultArtifact): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
	await rename(temporary, path);
}
function removeOrchestrationCatalog(event: BeforeAgentStartEvent): string {
	const skills = event.systemPromptOptions.skills ?? [];
	const filtered = skills.filter((skill) => skill.name !== "orchestrate");
	if (filtered.length === skills.length) return event.systemPrompt;
	const readTool = event.systemPromptOptions.selectedTools?.includes("read") ? "read" : "bash";
	return event.systemPrompt.replace(formatSkillsForPrompt(skills, readTool), formatSkillsForPrompt(filtered, readTool));
}
function parseEnvelope(encoded: string, expectedWorker: string): ActiveTask | undefined {
	try {
		const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
		if (!Value.Check(activeTaskSchema, value) || value.worker !== expectedWorker || !SAFE_ID.test(expectedWorker)) {
			return undefined;
		}
		return { taskId: value.taskId, worker: expectedWorker, startedAt: value.startedAt };
	} catch {
		return undefined;
	}
}

/** Registers the task-correlated child result reporter. */
export function registerChildReporter(pi: ExtensionAPI, resultRoot: string, worker: string): void {
	let active: ActiveTask | undefined;
	pi.on("input", (event, ctx) => {
		if (event.text.startsWith("/skill:orchestrate")) {
			ctx.ui.notify("The orchestration skill is unavailable in delegated workers.", "warning");
			return { action: "handled" };
		}
		const match = TASK_PREFIX.exec(event.text);
		if (!match) return { action: "continue" };
		const task = (match[2] ?? "").trim();
		const envelope = parseEnvelope(match[1] ?? "", worker);
		if (active || !envelope || !task) return { action: "handled" };
		active = envelope;
		return { action: "transform", text: `Delegated task:\n\n${task}` };
	});
	pi.on("before_agent_start", (event) => ({ systemPrompt: removeOrchestrationCatalog(event) }));

	const report = async (ctx: ExtensionContext, shutdownError?: string): Promise<void> => {
		const task = active;
		if (!task || (shutdownError === undefined && !ctx.isIdle())) return;
		active = undefined;
		const assistant = latestAssistant(ctx, task.startedAt);
		const stopReason = assistant?.stopReason;
		const status = shutdownError !== undefined || !assistant || stopReason === "error" || stopReason === "aborted"
			? "failed" : stopReason === "stop" ? "completed" : "incomplete";
		const defaultError = !assistant ? "Task settled without a new assistant response."
			: status === "incomplete" ? `Assistant response was not final (${stopReason ?? "unknown"}).` : undefined;
		try {
			const artifact: ChildResultArtifact = {
				version: 1, taskId: task.taskId, worker, status,
				output: assistant ? assistantText(assistant) : "",
				session: ctx.sessionManager.getSessionFile() ?? ctx.sessionManager.getSessionId(),
				provider: assistant?.provider ?? ctx.model?.provider ?? "",
				model: assistant?.model ?? ctx.model?.id ?? "",
				thinking: pi.getThinkingLevel(), finishedAt: Date.now(),
			};
			const error = shutdownError ?? assistant?.errorMessage ?? defaultError;
			if (error !== undefined) artifact.error = error;
			if (stopReason !== undefined) artifact.stopReason = stopReason;
			await writeJsonAtomic(join(resultRoot, worker, `${task.taskId}.json`), artifact);
		} catch (cause) { console.error(`[herdr-delegate] Result write failed: ${cause instanceof Error ? cause.message : String(cause)}`); }
	};
	pi.on("agent_settled", async (_event, ctx) => report(ctx));
	pi.on("session_shutdown", async (_event, ctx) => report(ctx, "Worker session shut down before the task settled."));
}

async function withValidationDeadline<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (signal?.aborted) throw new DelegationError("cancelled", "validation aborted before starting");
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new DelegationError("auth_timeout", "provider authentication validation exceeded 10 seconds")), 10_000);
		const abort = () => reject(new DelegationError("cancelled", "validation aborted"));
		signal?.addEventListener("abort", abort, { once: true });
		promise.then(resolve, reject).finally(() => { clearTimeout(timer); signal?.removeEventListener("abort", abort); });
	});
}

/** Registers the parent delegation tool or the isolated child reporter. */
export default async function herdrDelegateExtension(pi: ExtensionAPI): Promise<void> {
	if (process.env[CHILD_ENV] === "1") {
		const resultRoot = process.env[RESULT_ROOT_ENV];
		const worker = process.env[WORKER_ENV];
		if (!resultRoot || !worker || !SAFE_ID.test(worker)) {
			console.error("[herdr-delegate] Valid child result root and worker id are required.");
			return;
		}
		registerChildReporter(pi, resultRoot, worker);
		return;
	}

	const agentDir = getAgentDir();
	const rolePaths = {
		builder: join(agentDir, "agents", "builder.md"),
		reviewer: join(agentDir, "agents", "reviewer.md"),
	} as const;
	const [builder, reviewer] = await Promise.all([
		loadRoleConfig(rolePaths.builder, "builder"),
		loadRoleConfig(rolePaths.reviewer, "reviewer"),
	]);
	const roleCatalog = [builder, reviewer]
		.map((result, index) =>
			result.ok
				? `${result.value.name} — ${result.value.description}`
				: `${index === 0 ? "builder" : "reviewer"} — invalid configuration`,
		)
		.join("; ");
	const resultRoot = join(agentDir, "herdr-delegate-runs");
	const reporterPath = fileURLToPath(import.meta.url);
	let runtime: DelegateRuntime | undefined;

	pi.on("session_start", (_event, ctx) => {
		let restoredState: DelegateRuntimeState | undefined;
		let initialStateError: string | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
			const parsed = Value.Check(delegateRuntimeStateSchema, entry.data)
				? parseDelegateRuntimeState(entry.data)
				: { ok: false, error: new DelegationError("state_invalid", "persisted state must be an object") } as const;
			if (parsed.ok) { restoredState = parsed.value; initialStateError = undefined; }
			else { restoredState = undefined; initialStateError = `corrupt persisted delegation authority: ${parsed.error.message}`; }
		}
		const validateRole = async (role: RoleConfig, signal?: AbortSignal): Promise<DelegationResult<void>> => {
			const model = ctx.modelRegistry.find(role.provider, role.model);
			if (!model) return { ok: false, error: new DelegationError("model_unavailable", `${role.provider}/${role.model}`) };
			if (!getSupportedThinkingLevels(model).includes(role.thinking)) {
				return {
					ok: false,
					error: new DelegationError(
						"thinking_unsupported",
						`${role.thinking} is unsupported by ${role.provider}/${role.model}`,
					),
				};
			}
			const unavailable = role.tools.filter((name) => !pi.getAllTools().some((tool) => tool.name === name));
			if (unavailable.length) return { ok: false, error: new DelegationError("tools_unavailable", unavailable.join(", ")) };
			try {
				const auth = await withValidationDeadline(ctx.modelRegistry.getProviderAuth(role.provider), signal);
				return auth ? { ok: true, value: undefined } : { ok: false, error: new DelegationError("auth_unavailable", role.provider) };
			} catch (cause) {
				return {
					ok: false,
					error: cause instanceof DelegationError
						? cause
						: new DelegationError("auth_failed", role.provider, cause),
				};
			}
		};
		type RuntimeOptionsDraft = ConstructorParameters<typeof DelegateRuntime>[0] & {
			initialState?: DelegateRuntimeState;
			initialStateError?: string;
		};
		const runtimeOptions: RuntimeOptionsDraft = {
			runHerdr: async (args, options) => {
				type HerdrExecOptions = { signal?: AbortSignal; timeout?: number };
				const execOptions: HerdrExecOptions = {};
				if (options?.signal !== undefined) execOptions.signal = options.signal;
				if (options?.timeoutMs !== undefined) execOptions.timeout = options.timeoutMs;
				const result = await pi.exec("herdr", [...args], execOptions);
				return { code: result.code, stdout: result.stdout, stderr: result.stderr, killed: result.killed };
			},
			validateRole, callerWorkspaceId: process.env.HERDR_WORKSPACE_ID ?? "", parentSessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd,
			resultRoot, reporterPath, rolePaths, onStateChange: (state) => pi.appendEntry(STATE_ENTRY, state),
		};
		if (restoredState !== undefined) runtimeOptions.initialState = restoredState;
		if (initialStateError !== undefined) runtimeOptions.initialStateError = initialStateError;
		runtime = new DelegateRuntime(runtimeOptions);
	});
	pi.on("agent_settled", async (_event, ctx) => {
		if (!isInsideHerdr() || !runtime || !ctx.isIdle() || ctx.hasPendingMessages()) return;
		const result = await runtime.cleanupOwned();
		if (!result.ok && result.error.code !== "cleanup_busy") {
			ctx.ui.notify(`Automatic delegation cleanup failed: ${result.error.message}`, "error");
		}
	});
	pi.on("session_shutdown", async (event) => {
		if (!isInsideHerdr() || !runtime || event.reason === "reload") return;
		await runtime.cleanupOwned();
	});
	pi.registerCommand("delegate-cleanup", {
		description: "Close only delegation workers pinned to this Pi session",
		handler: async (_args, ctx) => {
			if (!isInsideHerdr()) {
				ctx.ui.notify("Delegation cleanup requires HERDR_ENV=1; no panes were touched.", "error");
				return;
			}
			if (!runtime) {
				ctx.ui.notify("Delegation runtime is unavailable.", "error");
				return;
			}
			const result = await runtime.cleanupOwned();
			ctx.ui.notify(result.ok ? "Owned delegation workers cleaned up." : result.error.message, result.ok ? "info" : "error");
		},
	});
	pi.registerTool({
		name: "delegate", label: "Delegate",
		description: `Delegate one blocking, sequential task to a visible Pi worker in a background Herdr tab. Roles: ${roleCatalog}. Start with role + task; use worker + task only for fixes in a successful builder. Reviewers are always fresh.`,
		promptSnippet: "Delegate implementation or fresh review in a visible Herdr background tab",
		promptGuidelines: ["Use delegate sequentially: one builder writes, a fresh reviewer inspects actual changes, and only the returned builder worker receives necessary fixes."],
		parameters: Type.Object({ task: Type.String(), role: Type.Optional(StringEnum(["builder", "reviewer"] as const)), worker: Type.Optional(Type.String()), timeoutMs: Type.Optional(Type.Integer({ minimum: 5_000, maximum: 3_600_000 })) }),
		async execute(_id, params, signal, onUpdate) {
			if (!isInsideHerdr()) throw new Error("Delegation requires HERDR_ENV=1 and caller workspace identity.");
			if (!runtime) throw new Error("Delegation runtime is not initialized.");
			onUpdate?.({ content: [{ type: "text", text: params.worker ? "Sending builder follow-up…" : `Starting ${params.role ?? "worker"}…` }], details: undefined });
			const delegated = await runtime.delegate(params, signal);
			if (!delegated.ok) throw delegated.error;
			const result = delegated.value;
			const cleanup = result.cleanup.status === "closed" ? "matching owned pane closed"
				: result.cleanup.status === "retained" ? "builder retained until the parent task settles"
				: `failed (${result.cleanup.error}); recovery lock retained`;
			return { content: [{ type: "text", text: [`${result.role} completed task ${result.taskId}.`, `Worker: ${result.worker}`, `Agent: ${result.agentName}`, `Pane: ${result.paneId}`, `Session: ${result.session}`, `Model: ${result.model} (${result.thinking})`, `Result artifact: ${result.resultPath}`, `Cleanup: ${cleanup}`, "", result.output].join("\n") }], details: result };
		},
	});
	pi.registerTool({
		name: "read_agent_activity", label: "Read Agent Activity",
		description: "Read bounded assistant text, tool calls/results, and errors incrementally from an owned worker's Pi session JSONL. Thinking is excluded. Activity is not completion proof; delegate result artifacts remain authoritative.",
		promptSnippet: "Read bounded JSONL activity from an owned delegated worker",
		promptGuidelines: ["Use read_agent_activity only with an opaque worker handle returned by delegate or included in an unresolved delegation error; treat it as activity, not task completion proof."],
		parameters: Type.Object({ worker: Type.String(), cursor: Type.Optional(Type.String()) }),
		async execute(_id, params) {
			if (!isInsideHerdr()) throw new Error("Agent activity inspection requires HERDR_ENV=1 and caller workspace identity.");
			if (!runtime) throw new Error("Delegation runtime is not initialized.");
			const read = await runtime.readAgentActivity(params);
			if (!read.ok) throw read.error;
			const result = read.value;
			return {
				content: [{ type: "text", text: [result.activity, "", `Cursor: ${result.cursor}`, `More complete activity: ${result.hasMore ? "yes" : "no"}`, result.incompleteTrailingLine ? "A trailing partial JSONL record was retained for a later read." : "", "Activity only; the task-correlated delegate result artifact is the sole completion answer."].filter(Boolean).join("\n") }],
				details: result,
			};
		},
	});
}
