import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { StringEnum } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	getAgentDir,
	keyHint,
	truncateHead,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { HerdrProtocol, type ChildResult, type HerdrAgentStatus, type ParseResult } from "./protocol.ts";

const CHILD_FLAG = "herdr-subagent-child";
const RESULT_FLAG = "herdr-subagent-result";
const RUNS_DIR = "herdr-subagents";
const POLL_INTERVAL_MS = 500;
const PANE_PREVIEW_LINES = 18;
const MISSING_AGENT_LIMIT = 4;
const SHELL_WAIT_ATTEMPTS = 25;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const EXTENSION_PATH = fileURLToPath(import.meta.url);

type RunStatus = "queued" | "running" | "blocked" | "completed" | "failed";

interface AssistantSnapshot {
	readonly output: string;
	readonly error?: string;
	readonly stopReason?: string;
	readonly provider?: string;
	readonly model?: string;
}

interface RunDetails {
	readonly status: RunStatus;
	readonly task: string;
	readonly cwd: string;
	readonly paneId?: string;
	readonly agentName: string;
	readonly focusCommand: string;
	readonly inspectCommand: string;
	readonly cleanupCommand: string;
	readonly provider: string;
	readonly model: string;
	readonly thinking: string;
	readonly pane?: string;
	readonly output?: string;
	readonly sessionFile?: string;
	readonly startedAt?: number;
	readonly finishedAt?: number;
}

interface RunSpec {
	readonly task: string;
	readonly cwd: string;
	readonly childSessionId: string;
	readonly agentName: string;
	readonly resultPath: string;
	readonly sessionDir: string;
	readonly provider: string;
	readonly model: string;
	readonly thinking: string;
	readonly trusted: boolean;
	paneId?: string;
}

type ChildResultRead =
	| { readonly status: "missing" }
	| { readonly status: "invalid"; readonly error: string }
	| { readonly status: "ready"; readonly result: ChildResult };

class HerdrSubagentError extends Error {
	readonly _tag = "HerdrSubagentError";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "HerdrSubagentError";
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): unknown {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	return error.code;
}

function unwrapParsed<T>(parsed: ParseResult<T>, operation: string): T {
	if (parsed.ok) return parsed.value;
	throw new HerdrSubagentError(`${operation} returned an unexpected response: ${parsed.error}`);
}

function findLastAssistant(ctx: ExtensionContext): AssistantSnapshot | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const message = entry.message;
		const output = message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		return {
			output,
			...(message.errorMessage === undefined ? {} : { error: message.errorMessage }),
			...(message.stopReason === undefined ? {} : { stopReason: message.stopReason }),
			...(message.provider === undefined ? {} : { provider: message.provider }),
			...(message.model === undefined ? {} : { model: message.model }),
		};
	}
	return undefined;
}

async function writeJsonOnce(filePath: string, value: unknown): Promise<void> {
	const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
	try {
		try {
			await link(temporaryPath, filePath);
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
		}
	} finally {
		await unlink(temporaryPath).catch(() => undefined);
	}
}

function registerChildReporter(pi: ExtensionAPI, resultPath: string): void {
	let reported = false;

	const report = async (ctx: ExtensionContext, fallbackError?: string): Promise<void> => {
		if (reported) return;
		reported = true;

		const assistant = findLastAssistant(ctx);
		const failed =
			assistant === undefined ||
			assistant.stopReason === "error" ||
			assistant.stopReason === "aborted" ||
			fallbackError !== undefined;
		const result: ChildResult = {
			version: 1,
			status: failed ? "failed" : "completed",
			output: assistant?.output ?? "",
			...(fallbackError !== undefined
				? { error: fallbackError }
				: assistant?.error !== undefined
					? { error: assistant.error }
					: assistant === undefined
						? { error: "Subagent exited without an assistant response." }
						: {}),
			...(assistant?.stopReason === undefined ? {} : { stopReason: assistant.stopReason }),
			...(ctx.sessionManager.getSessionFile() === undefined
				? {}
				: { sessionFile: ctx.sessionManager.getSessionFile() }),
			...((assistant?.provider ?? ctx.model?.provider) ? { provider: assistant?.provider ?? ctx.model?.provider } : {}),
			...((assistant?.model ?? ctx.model?.id) ? { model: assistant?.model ?? ctx.model?.id } : {}),
			thinking: pi.getThinkingLevel(),
			finishedAt: Date.now(),
		};

		try {
			await writeJsonOnce(resultPath, result);
		} catch (error) {
			console.error(`[herdr-subagent] Failed to write child result: ${errorMessage(error)}`);
		}
	};

	pi.on("agent_settled", async (_event, ctx) => {
		await report(ctx);
		ctx.shutdown();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!reported) await report(ctx, "Subagent session shut down before the task settled.");
	});
}

function trimPane(output: string): string {
	const lines = output.replace(/\r/g, "").split("\n");
	while (lines.length > 0 && !lines[0]?.trim()) lines.shift();
	while (lines.length > 0 && !lines[lines.length - 1]?.trim()) lines.pop();
	return lines.slice(-PANE_PREVIEW_LINES).join("\n");
}

function formatDuration(startedAt: number | undefined, finishedAt = Date.now()): string | undefined {
	if (startedAt === undefined) return undefined;
	const seconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${seconds % 60}s`;
}

function shellQuote(value: string): string {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function detailsFor(spec: RunSpec, status: RunStatus, extra: Partial<RunDetails> = {}): RunDetails {
	const paneId = spec.paneId;
	return {
		status,
		task: spec.task,
		cwd: spec.cwd,
		...(paneId === undefined ? {} : { paneId }),
		agentName: spec.agentName,
		focusCommand: `herdr agent focus ${shellQuote(spec.agentName)}`,
		inspectCommand:
			paneId === undefined
				? "(pane not created yet)"
				: `herdr pane read ${shellQuote(paneId)} --source recent-unwrapped --lines 120`,
		cleanupCommand: paneId === undefined ? "(pane not created yet)" : `herdr pane close ${shellQuote(paneId)}`,
		provider: spec.provider,
		model: spec.model,
		thinking: spec.thinking,
		...extra,
	};
}

function partialText(details: RunDetails): string {
	if (details.status === "queued") return "Waiting for the active Herdr subagent to finish...";
	const lines = [
		details.status === "blocked"
			? `Subagent is blocked in Herdr pane ${details.paneId ?? "(unknown)"}; focus it to respond.`
			: `Subagent ${details.status} in Herdr pane ${details.paneId ?? "(unknown)"}.`,
		`Focus: ${details.focusCommand}`,
		`Inspect: ${details.inspectCommand}`,
	];
	if (details.pane) lines.push("", details.pane);
	return lines.join("\n");
}

function truncateToolText(text: string): string {
	const truncated = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
	if (!truncated.truncated) return truncated.content;
	return `${truncated.content}\n\n[Output truncated. Full output is available in the child session file.]`;
}

function resultText(details: RunDetails): string {
	const duration = formatDuration(details.startedAt, details.finishedAt);
	const lines = [
		`Subagent ${details.status}${duration ? ` after ${duration}` : ""}.`,
		`Model: ${details.provider}/${details.model} (${details.thinking})`,
		`Herdr pane: ${details.paneId ?? "(unknown)"}`,
		`Inspect: ${details.inspectCommand}`,
		`Clean up: ${details.cleanupCommand}`,
	];
	if (details.sessionFile) lines.push(`Child session: ${details.sessionFile}`);
	if (details.output) lines.push("", details.output);
	return truncateToolText(lines.join("\n"));
}

async function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
	if (signal?.aborted) throw new HerdrSubagentError("Subagent aborted.");
	await new Promise<void>((resolve, reject) => {
		const cleanup = () => signal?.removeEventListener("abort", onAbort);
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			cleanup();
			reject(new HerdrSubagentError("Subagent aborted."));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function resolveDirectory(cwd: string): Promise<string> {
	let info;
	try {
		info = await stat(cwd);
	} catch (error) {
		throw new HerdrSubagentError(`Subagent working directory does not exist: ${cwd}`, { cause: error });
	}
	if (!info.isDirectory()) throw new HerdrSubagentError(`Subagent working directory is not a directory: ${cwd}`);
	return realpath(cwd);
}

function isSameOrDescendant(base: string, candidate: string): boolean {
	const relative = path.relative(base, candidate);
	return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolveModel(
	ctx: ExtensionContext,
	providerOverride: string | undefined,
	modelOverride: string | undefined,
): { readonly provider: string; readonly model: string } {
	const explicitProvider = providerOverride?.trim();
	const explicitModel = modelOverride?.trim();
	let provider = explicitProvider || ctx.model?.provider || "";
	let model = explicitModel || ctx.model?.id || "";

	const slashIndex = explicitModel?.indexOf("/") ?? -1;
	if (explicitModel && slashIndex > 0) {
		const modelProvider = explicitModel.slice(0, slashIndex);
		if (!explicitProvider) {
			provider = modelProvider;
			model = explicitModel.slice(slashIndex + 1);
		} else if (explicitProvider === modelProvider) {
			model = explicitModel.slice(slashIndex + 1);
		}
	}

	if (!provider || !model) {
		throw new HerdrSubagentError("No model is active. Pass both provider and model to the subagent tool.");
	}
	return { provider, model };
}

async function readChildResult(resultPath: string): Promise<ChildResultRead> {
	let content: string;
	try {
		content = await readFile(resultPath, "utf8");
	} catch (error) {
		if (errorCode(error) === "ENOENT") return { status: "missing" };
		throw new HerdrSubagentError(`Could not read child result at ${resultPath}: ${errorMessage(error)}`, {
			cause: error,
		});
	}
	const parsed = HerdrProtocol.parseChildResult(content);
	return parsed.ok ? { status: "ready", result: parsed.value } : { status: "invalid", error: parsed.error };
}

/** Register the serial, observable Herdr-backed subagent tool. */
export default function herdrSubagentExtension(pi: ExtensionAPI): void {
	pi.registerFlag(CHILD_FLAG, {
		description: "Run as a Herdr subagent child",
		type: "boolean",
		default: false,
	});
	pi.registerFlag(RESULT_FLAG, {
		description: "Write the Herdr subagent result to this path",
		type: "string",
	});

	if (pi.getFlag(CHILD_FLAG) === true) {
		const resultPath = pi.getFlag(RESULT_FLAG);
		if (typeof resultPath !== "string" || !path.isAbsolute(resultPath)) {
			console.error(`[herdr-subagent] --${RESULT_FLAG} must be an absolute path in child mode.`);
			return;
		}
		registerChildReporter(pi, resultPath);
		return;
	}

	const callerPaneId = process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID : undefined;
	if (!callerPaneId) return;

	let queueTail: Promise<void> = Promise.resolve();
	let queueDepth = 0;
	let ownedPaneId: string | undefined;
	let activeAgentName: string | undefined;

	const runHerdr = (
		args: readonly string[],
		options: { readonly signal?: AbortSignal; readonly timeout?: number } = {},
	) => pi.exec("herdr", [...args], options);

	const isPaneAtShell = async (paneId: string): Promise<boolean> => {
		const result = await runHerdr(["pane", "process-info", "--pane", paneId], { timeout: 5_000 });
		if (result.code !== 0) return false;
		const parsed = HerdrProtocol.parseProcessInfo(result.stdout);
		if (!parsed.ok) return false;
		return (
			parsed.value.foregroundPids.length === 0 ||
			parsed.value.foregroundPids.every((pid) => pid === parsed.value.shellPid)
		);
	};

	const closeOwnedPane = async (force: boolean): Promise<void> => {
		const paneId = ownedPaneId;
		if (!paneId) return;
		if (!force && activeAgentName === undefined && !(await isPaneAtShell(paneId))) {
			ownedPaneId = undefined;
			return;
		}
		ownedPaneId = undefined;
		activeAgentName = undefined;
		await runHerdr(["pane", "close", paneId], { timeout: 5_000 });
	};

	const createPane = async (cwd: string): Promise<string> => {
		const layout = await runHerdr(["pane", "layout", "--pane", callerPaneId], { timeout: 5_000 });
		if (layout.code !== 0) {
			throw new HerdrSubagentError(
				`Herdr could not inspect caller pane ${callerPaneId}: ${layout.stderr.trim() || "unknown error"}`,
			);
		}
		const rect = unwrapParsed(HerdrProtocol.parsePaneRect(layout.stdout, callerPaneId), "herdr pane layout");
		const direction = rect.width >= rect.height * 2 ? "right" : "down";
		const split = await runHerdr(
			["pane", "split", "--pane", callerPaneId, "--direction", direction, "--cwd", cwd, "--no-focus"],
			{ timeout: 10_000 },
		);
		if (split.code !== 0) {
			throw new HerdrSubagentError(
				`Herdr could not create a subagent pane: ${split.stderr.trim() || split.stdout.trim() || "unknown error"}`,
			);
		}
		const paneId = unwrapParsed(HerdrProtocol.parseSplitPaneId(split.stdout), "herdr pane split");
		ownedPaneId = paneId;
		return paneId;
	};

	const ensurePane = async (cwd: string): Promise<string> => {
		if (ownedPaneId) {
			const paneId = ownedPaneId;
			const pane = await runHerdr(["pane", "get", paneId], { timeout: 5_000 });
			if (pane.code !== 0) {
				ownedPaneId = undefined;
				activeAgentName = undefined;
			} else if (await isPaneAtShell(paneId)) {
				activeAgentName = undefined;
				const paneCwd = HerdrProtocol.parsePaneCwd(pane.stdout);
				if (paneCwd.ok && paneCwd.value === cwd) return paneId;
				await closeOwnedPane(true);
			} else if (activeAgentName) {
				throw new HerdrSubagentError(
					`The previous subagent in Herdr pane ${paneId} has not returned to its shell. Inspect it before retrying.`,
				);
			} else {
				ownedPaneId = undefined;
			}
		}
		return createPane(cwd);
	};

	const waitForShell = async (paneId: string): Promise<void> => {
		for (let attempt = 0; attempt < SHELL_WAIT_ATTEMPTS; attempt++) {
			if (await isPaneAtShell(paneId)) {
				activeAgentName = undefined;
				return;
			}
			await abortableDelay(100, undefined);
		}
	};

	const withSerialExecution = async <T>(
		signal: AbortSignal | undefined,
		onQueued: () => void,
		operation: () => Promise<T>,
	): Promise<T> => {
		const queued = queueDepth > 0;
		queueDepth += 1;
		const previous = queueTail;
		let release: () => void = () => {};
		queueTail = new Promise<void>((resolve) => {
			release = resolve;
		});
		if (queued) onQueued();

		try {
			await previous;
			if (signal?.aborted) throw new HerdrSubagentError("Subagent aborted while waiting in the serial queue.");
			return await operation();
		} finally {
			queueDepth -= 1;
			release();
		}
	};

	pi.on("session_shutdown", async () => {
		await closeOwnedPane(false);
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description:
			"Run one delegated task in a separate interactive Pi process in a reusable Herdr pane. Calls are serialized, so only one child works at a time. The child inherits the current provider, model, thinking level, working directory, and project trust unless overridden. Live terminal output is shown while it runs. Output is capped at 50KB or 2000 lines; the complete child session is preserved on disk.",
		promptSnippet: "Run one bounded delegated task in an observable Herdr-backed Pi session",
		promptGuidelines: [
			"Use subagent for bounded independent investigation, implementation, or review where an isolated context or second opinion is valuable; do not delegate trivial or tightly coupled work.",
			"Use subagent once per delegated task. Calls are serialized automatically, and each task must include all context the child needs.",
		],
		parameters: Type.Object({
			task: Type.String({ description: "The complete, self-contained task for the child Pi process" }),
			cwd: Type.Optional(Type.String({ description: "Working directory. Defaults to the current project." })),
			provider: Type.Optional(Type.String({ description: "Provider override. Defaults to the current provider." })),
			model: Type.Optional(
				Type.String({ description: "Model id or provider/model override. Defaults to the current model." }),
			),
			thinking: Type.Optional(
				StringEnum(THINKING_LEVELS, {
					description: "Thinking level override. Defaults to the current thinking level.",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const task = params.task.trim();
			if (!task) throw new HerdrSubagentError("Subagent task must not be empty.");
			const requestedCwd = path.resolve(ctx.cwd, params.cwd?.trim() || ".");
			const selectedModel = resolveModel(ctx, params.provider, params.model);
			const thinking = params.thinking ?? pi.getThinkingLevel();
			const childSessionId = randomUUID();
			const agentName = `subagent-${childSessionId.slice(0, 8)}`;
			const runDir = path.join(getAgentDir(), RUNS_DIR, ctx.sessionManager.getSessionId(), childSessionId);
			const resultPath = path.join(runDir, "result.json");
			const sessionDir = path.join(runDir, "session");
			const spec: RunSpec = {
				task,
				cwd: requestedCwd,
				childSessionId,
				agentName,
				resultPath,
				sessionDir,
				provider: selectedModel.provider,
				model: selectedModel.model,
				thinking,
				trusted: false,
			};

			return withSerialExecution(
				signal,
				() => {
					const details = detailsFor(spec, "queued");
					onUpdate?.({ content: [{ type: "text", text: partialText(details) }], details });
				},
				async () => {
					const version = await runHerdr(["--version"], { signal, timeout: 5_000 });
					if (version.code !== 0) {
						throw new HerdrSubagentError(
							`Herdr is required for subagents: ${version.stderr.trim() || "herdr was not available"}`,
						);
					}

					const cwd = await resolveDirectory(requestedCwd);
					const trustedBase = await resolveDirectory(ctx.cwd);
					const trusted = isSameOrDescendant(trustedBase, cwd) && ctx.isProjectTrusted();
					const resolvedSpec: RunSpec = { ...spec, cwd, trusted };
					await mkdir(sessionDir, { recursive: true, mode: 0o700 });
					await writeFile(path.join(runDir, "task.md"), `# Delegated task\n\n${task}\n`, {
						encoding: "utf8",
						mode: 0o600,
					});

					const paneId = await ensurePane(cwd);
					resolvedSpec.paneId = paneId;
					activeAgentName = agentName;
					const startedAt = Date.now();
					const startArgs = [
						"agent",
						"start",
						agentName,
						"--kind",
						"pi",
						"--pane",
						paneId,
						"--timeout",
						"30000",
						"--",
						"--provider",
						selectedModel.provider,
						"--model",
						selectedModel.model,
						"--thinking",
						thinking,
						"--session-dir",
						sessionDir,
						"--session-id",
						childSessionId,
						"--name",
						agentName,
						trusted ? "--approve" : "--no-approve",
						"--extension",
						EXTENSION_PATH,
						`--${CHILD_FLAG}`,
						`--${RESULT_FLAG}`,
						resultPath,
					];

					try {
						const started = await runHerdr(startArgs, { signal, timeout: 35_000 });
						if (started.code !== 0) {
							await closeOwnedPane(true);
							throw new HerdrSubagentError(
								`Herdr could not start child Pi: ${started.stderr.trim() || started.stdout.trim() || "unknown error"}`,
							);
						}

						const initialDetails = detailsFor(resolvedSpec, "running", { startedAt });
						onUpdate?.({ content: [{ type: "text", text: partialText(initialDetails) }], details: initialDetails });

						const prompt = await runHerdr(["agent", "prompt", agentName, `# Delegated task\n\n${task}`], {
							signal,
							timeout: 10_000,
						});
						if (prompt.code !== 0) {
							await closeOwnedPane(true);
							throw new HerdrSubagentError(
								`Herdr could not submit the delegated task: ${prompt.stderr.trim() || prompt.stdout.trim() || "unknown error"}`,
							);
						}

						let lastPane = "";
						let lastEmittedPane = "";
						let lastStatus: HerdrAgentStatus | undefined;
						let missingAgentCount = 0;
						let childResult: ChildResult | undefined;
						while (!childResult) {
							if (signal?.aborted) throw new HerdrSubagentError("Subagent aborted.");
							const resultRead = await readChildResult(resultPath);
							if (resultRead.status === "invalid") {
								throw new HerdrSubagentError(`Child Pi wrote an invalid result: ${resultRead.error}`);
							}
							if (resultRead.status === "ready") {
								childResult = resultRead.result;
								break;
							}

							const [read, agent] = await Promise.all([
								runHerdr(["agent", "read", agentName, "--source", "recent-unwrapped", "--lines", "120"], {
									signal,
									timeout: 5_000,
								}),
								runHerdr(["agent", "get", agentName], { signal, timeout: 5_000 }),
							]);
							if (read.code === 0) {
								const pane = trimPane(read.stdout);
								if (pane) lastPane = pane;
							}

							let status: HerdrAgentStatus | undefined;
							if (agent.code === 0) {
								status = unwrapParsed(HerdrProtocol.parseAgentStatus(agent.stdout), "herdr agent get");
								missingAgentCount = 0;
							} else {
								missingAgentCount += 1;
							}

							if (lastPane && (lastPane !== lastEmittedPane || status !== lastStatus)) {
								const details = detailsFor(resolvedSpec, status === "blocked" ? "blocked" : "running", {
									pane: lastPane,
									startedAt,
								});
								onUpdate?.({ content: [{ type: "text", text: partialText(details) }], details });
								lastEmittedPane = lastPane;
							}
							lastStatus = status;

							if (missingAgentCount >= MISSING_AGENT_LIMIT) {
								const pane = await runHerdr(
									["pane", "read", paneId, "--source", "recent-unwrapped", "--lines", "120"],
									{ signal, timeout: 5_000 },
								);
								if (pane.code === 0) lastPane = trimPane(pane.stdout) || lastPane;
								throw new HerdrSubagentError(
									`Child Pi exited before reporting a result.\n\n${lastPane || "No pane output."}\n\nInspect: ${initialDetails.inspectCommand}`,
								);
							}
							await abortableDelay(POLL_INTERVAL_MS, signal);
						}

						const finalPane = await runHerdr(
							["pane", "read", paneId, "--source", "recent-unwrapped", "--lines", "120"],
							{ timeout: 5_000 },
						);
						const pane = finalPane.code === 0 ? trimPane(finalPane.stdout) : lastPane;
						await waitForShell(paneId);

						let rawOutput = childResult.output.trim();
						if (childResult.status === "failed" && childResult.error?.trim()) {
							rawOutput += `${rawOutput ? "\n\n" : ""}Error: ${childResult.error.trim()}`;
						}
						const status: RunStatus = childResult.status === "completed" ? "completed" : "failed";
						const output = truncateToolText(rawOutput || "(no text output)");
						const details = detailsFor(resolvedSpec, status, {
							pane,
							output,
							...(childResult.sessionFile === undefined ? {} : { sessionFile: childResult.sessionFile }),
							provider: childResult.provider ?? resolvedSpec.provider,
							model: childResult.model ?? resolvedSpec.model,
							thinking: childResult.thinking ?? resolvedSpec.thinking,
							startedAt,
							finishedAt: childResult.finishedAt,
						});
						if (childResult.status === "failed") throw new HerdrSubagentError(resultText(details));
						return { content: [{ type: "text", text: resultText(details) }], details };
					} catch (error) {
						if (signal?.aborted) {
							await closeOwnedPane(true);
							throw new HerdrSubagentError("Subagent aborted.", { cause: error });
						}
						throw error;
					}
				},
			);
		},

		renderCall(args, theme) {
			const task = args.task?.trim() || "...";
			const firstLine = task.split("\n", 1)[0] ?? task;
			const preview = firstLine.length > 100 ? `${firstLine.slice(0, 100)}…` : firstLine;
			let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("dim", preview);
			const overrides = [args.provider, args.model, args.thinking].filter(Boolean);
			if (overrides.length > 0) text += `\n  ${theme.fg("muted", overrides.join(" · "))}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			// SAFETY: This renderer receives details produced only by this tool's execute/onUpdate paths.
			const details = result.details as RunDetails | undefined;
			if (!details) {
				const content = result.content.find((part) => part.type === "text");
				return new Text(content?.type === "text" ? content.text : "(no output)", 0, 0);
			}

			const running =
				isPartial || details.status === "queued" || details.status === "running" || details.status === "blocked";
			const icon = running
				? theme.fg("warning", details.status === "queued" ? "◦" : details.status === "blocked" ? "!" : "●")
				: details.status === "completed"
					? theme.fg("success", "✓")
					: theme.fg("error", "✗");
			const duration = formatDuration(details.startedAt, details.finishedAt);
			let text = `${icon} ${theme.fg("toolTitle", theme.bold(details.agentName))}`;
			text += theme.fg("muted", ` · ${details.status}${duration ? ` · ${duration}` : ""}`);
			if (details.paneId) text += `\n  ${theme.fg("accent", `Herdr pane ${details.paneId}`)}`;
			text += `\n  ${theme.fg("dim", `${details.provider}/${details.model} (${details.thinking})`)}`;

			if (running && details.pane) {
				const paneLines = details.pane.split("\n");
				const visible = expanded ? paneLines : paneLines.slice(-8);
				text += `\n\n${visible.map((line) => theme.fg("dim", line)).join("\n")}`;
			} else if (!running && details.output) {
				const outputLines = details.output.split("\n");
				const visible = expanded ? outputLines : outputLines.slice(0, 8);
				text += `\n\n${visible.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
				if (!expanded && outputLines.length > visible.length) {
					text += `\n${theme.fg("muted", `(${keyHint("app.tools.expand", "to expand")})`)}`;
				}
				text += `\n\n  ${theme.fg("dim", `inspect: ${details.inspectCommand}`)}`;
				text += `\n  ${theme.fg("dim", `cleanup: ${details.cleanupCommand}`)}`;
			}
			return new Text(text, 0, 0);
		},
	});
}
