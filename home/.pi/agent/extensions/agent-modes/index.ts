import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type AgentMode = "primary" | "subagent";

interface AgentDefinition {
	id: string;
	label?: string;
	description?: string;
	mode: AgentMode;
	system?: string | string[];
	systemFile?: string;
	tools?: string[];
	model?: string;
	thinking?: ThinkingLevel;
	background?: boolean;
}

interface AgentModesConfig {
	cycleKey?: string;
	primary?: AgentDefinition[];
	subagents?: AgentDefinition[];
}

interface LoadedConfig {
	cycleKey: string;
	primary: AgentDefinition[];
	subagents: AgentDefinition[];
	files: string[];
	warnings: string[];
}

interface ChildResult {
	id: string;
	state: "completed" | "error" | "cancelled";
	output: string;
	exitCode: number | null;
	stderr: string;
}

interface Job {
	id: string;
	agent: string;
	description: string;
	prompt: string;
	startedAt: number;
	process: ChildProcessWithoutNullStreams;
	done: Promise<ChildResult>;
}

const TOOL_NAME = "subagent";
const DEFAULT_CYCLE_KEY = "tab";
const BUILTIN_CHILD_TOOLS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
const NO_TEXT = "Subagent completed without a text response.";
const BACKGROUND_STARTED =
	"Started background subagent. You will be notified automatically when it finishes; do not poll for progress.";

let config: LoadedConfig = emptyConfig();
let activePrimaryId: string | undefined;
let defaultTools: string[] | undefined;
let defaultThinking: ThinkingLevel | undefined;
let defaultModel: ExtensionContext["model"] | undefined;
const jobs = new Map<string, Job>();

function emptyConfig(): LoadedConfig {
	return { cycleKey: DEFAULT_CYCLE_KEY, primary: [], subagents: [], files: [], warnings: [] };
}

function asStringArray(value: unknown): string[] | undefined {
	if (typeof value === "string") return [value];
	if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
	return undefined;
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return ["off", "minimal", "low", "medium", "high", "xhigh"].includes(String(value));
}

function parseAgent(value: unknown, mode: AgentMode, source: string, warnings: string[]): AgentDefinition | undefined {
	if (!value || typeof value !== "object") {
		warnings.push(`${source}: agent entry must be an object.`);
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string" || record.id.trim() === "") {
		warnings.push(`${source}: agent entry is missing string id.`);
		return undefined;
	}
	const tools = asStringArray(record.tools);
	if (record.tools !== undefined && !tools) warnings.push(`${source}: ${record.id}.tools must be a string array.`);
	const system = asStringArray(record.system);
	if (record.system !== undefined && !system) warnings.push(`${source}: ${record.id}.system must be a string or string array.`);
	const thinking = record.thinking;
	if (thinking !== undefined && !isThinkingLevel(thinking)) warnings.push(`${source}: ${record.id}.thinking is invalid.`);

	return {
		id: record.id,
		label: typeof record.label === "string" ? record.label : undefined,
		description: typeof record.description === "string" ? record.description : undefined,
		mode,
		system,
		systemFile: typeof record.systemFile === "string" ? record.systemFile : undefined,
		tools,
		model: typeof record.model === "string" ? record.model : undefined,
		thinking: isThinkingLevel(thinking) ? thinking : undefined,
		background: typeof record.background === "boolean" ? record.background : undefined,
	};
}

function parseConfigFile(filePath: string): Partial<LoadedConfig> {
	const warnings: string[] = [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch (error) {
		return { warnings: [`${filePath}: could not read or parse JSON: ${String(error)}`] };
	}
	if (!parsed || typeof parsed !== "object") return { warnings: [`${filePath}: config must be a JSON object.`] };
	const record = parsed as Record<string, unknown>;
	const primary = Array.isArray(record.primary)
		? record.primary.map((item) => parseAgent(item, "primary", filePath, warnings)).filter((item): item is AgentDefinition => Boolean(item))
		: undefined;
	const subagents = Array.isArray(record.subagents)
		? record.subagents.map((item) => parseAgent(item, "subagent", filePath, warnings)).filter((item): item is AgentDefinition => Boolean(item))
		: undefined;
	return {
		cycleKey: typeof record.cycleKey === "string" && record.cycleKey.trim() ? record.cycleKey.trim() : undefined,
		primary,
		subagents,
		warnings,
	};
}

function findProjectConfig(cwd: string): string | undefined {
	let current = cwd;
	while (true) {
		const candidate = path.join(current, CONFIG_DIR_NAME, "agent-modes.json");
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function loadConfig(ctx?: ExtensionContext): LoadedConfig {
	const next = emptyConfig();
	const files = [path.join(getAgentDir(), "agent-modes.json")];
	if (ctx?.isProjectTrusted()) {
		const projectConfig = findProjectConfig(ctx.cwd);
		if (projectConfig) files.push(projectConfig);
	}

	for (const file of files) {
		if (!fs.existsSync(file)) continue;
		const parsed = parseConfigFile(file);
		next.files.push(file);
		if (parsed.cycleKey) next.cycleKey = parsed.cycleKey;
		if (parsed.primary) next.primary = parsed.primary;
		if (parsed.subagents) next.subagents = parsed.subagents;
		next.warnings.push(...(parsed.warnings ?? []));
	}
	return next;
}

function unique(values: string[]): string[] {
	return Array.from(new Set(values));
}

function validatePrimaryTools(pi: ExtensionAPI, ctx: ExtensionContext, agent: AgentDefinition): string[] | undefined {
	if (!agent.tools) return undefined;
	const known = new Set(pi.getAllTools().map((tool) => tool.name));
	const valid = unique(agent.tools).filter((tool) => known.has(tool));
	const invalid = unique(agent.tools).filter((tool) => !known.has(tool));
	if (invalid.length > 0) ctx.ui.notify(`Agent ${agent.id}: unknown Pi tools ignored: ${invalid.join(", ")}`, "warning");
	return valid;
}

function validateChildTools(ctx: ExtensionContext, agent: AgentDefinition): string[] | undefined {
	if (!agent.tools) return undefined;
	const valid = unique(agent.tools).filter((tool) => BUILTIN_CHILD_TOOLS.has(tool));
	const invalid = unique(agent.tools).filter((tool) => !BUILTIN_CHILD_TOOLS.has(tool));
	if (invalid.length > 0) ctx.ui.notify(`Subagent ${agent.id}: unknown or unavailable child tools ignored: ${invalid.join(", ")}`, "warning");
	return valid;
}

function currentPrimary(): AgentDefinition | undefined {
	return activePrimaryId ? config.primary.find((agent) => agent.id === activePrimaryId) : undefined;
}

function displayName(agent: AgentDefinition): string {
	return agent.label ?? agent.id;
}

function systemText(agent: AgentDefinition, cwd: string): string {
	const parts: string[] = [];
	if (agent.system) parts.push(Array.isArray(agent.system) ? agent.system.join("\n") : agent.system);
	if (agent.systemFile) {
		const filePath = path.isAbsolute(agent.systemFile) ? agent.systemFile : path.resolve(cwd, agent.systemFile);
		try {
			parts.push(fs.readFileSync(filePath, "utf8"));
		} catch (error) {
			parts.push(`Agent systemFile could not be read: ${filePath}. Error: ${String(error)}`);
		}
	}
	return parts.filter((part) => part.trim()).join("\n\n");
}

function capturePiDefaults(pi: ExtensionAPI, ctx: ExtensionContext): void {
	defaultTools = pi.getActiveTools().filter((tool) => tool !== TOOL_NAME);
	const thinking = pi.getThinkingLevel();
	defaultThinking = isThinkingLevel(thinking) ? thinking : undefined;
	defaultModel = ctx.model;
}

async function restorePiDefaults(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!defaultTools) capturePiDefaults(pi, ctx);
	if (defaultTools) pi.setActiveTools(defaultTools);
	if (defaultThinking) pi.setThinkingLevel(defaultThinking);
	if (defaultModel) {
		const restored = await pi.setModel(defaultModel);
		if (!restored) ctx.ui.notify("Could not restore the previous Pi mode model.", "warning");
	}
}

async function applyPrimary(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const active = currentPrimary();

	if (!active) {
		await restorePiDefaults(pi, ctx);
		ctx.ui.setStatus("agent-mode", "Mode: Pi");
		return;
	}

	const tools = validatePrimaryTools(pi, ctx, active);
	if (tools) pi.setActiveTools(tools);
	if (active.thinking) pi.setThinkingLevel(active.thinking);
	if (active.model) {
		const slash = active.model.indexOf("/");
		const model = slash > 0 ? ctx.modelRegistry.find(active.model.slice(0, slash), active.model.slice(slash + 1)) : undefined;
		if (model) await pi.setModel(model);
		else ctx.ui.notify(`Agent ${active.id}: model must be provider/id and available: ${active.model}`, "warning");
	}
	ctx.ui.setStatus("agent-mode", `Mode: ${displayName(active)}`);
}

async function switchTo(pi: ExtensionAPI, ctx: ExtensionContext, id: string | undefined): Promise<void> {
	if (id && !config.primary.some((agent) => agent.id === id)) {
		ctx.ui.notify(`Unknown primary agent: ${id}`, "warning");
		return;
	}
	if (activePrimaryId === undefined) capturePiDefaults(pi, ctx);
	activePrimaryId = id;
	await applyPrimary(pi, ctx);
	const selected = id ? config.primary.find((agent) => agent.id === id) : undefined;
	ctx.ui.notify(`Agent mode: ${selected ? displayName(selected) : "Pi"}`, "info");
}

async function cyclePrimary(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (config.primary.length === 0) {
		ctx.ui.notify("No primary agents configured in agent-modes.json", "warning");
		return;
	}
	const ids = [undefined, ...config.primary.map((agent) => agent.id)];
	const currentIndex = ids.findIndex((id) => id === activePrimaryId);
	const next = ids[(currentIndex + 1) % ids.length];
	await switchTo(pi, ctx, next);
}

function latestAssistantText(messages: Array<{ role?: string; content?: unknown }>): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		const text = message.content
			.filter((part): part is { type: string; text: string } => {
				return Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string");
			})
			.map((part) => part.text)
			.join("");
		if (text.trim()) return text;
	}
	return NO_TEXT;
}

function piInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) return { command: process.execPath, args: [currentScript, ...args] };
	const execName = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(execName)) return { command: process.execPath, args };
	return { command: "pi", args };
}

function startChild(ctx: ExtensionContext, agent: AgentDefinition, description: string, prompt: string, signal?: AbortSignal): Job {
	const id = randomUUID();
	const args = ["--mode", "json", "-p", "--no-session", "--no-extensions"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.thinking) args.push("--thinking", agent.thinking);
	const childTools = validateChildTools(ctx, agent);
	if (childTools && childTools.length > 0) args.push("--tools", childTools.join(","));
	const system = systemText(agent, ctx.cwd);
	if (system.trim()) args.push("--append-system-prompt", system);
	args.push(`Task: ${prompt}`);

	const invocation = piInvocation(args);
	const proc = spawn(invocation.command, invocation.args, { cwd: ctx.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
	const messages: Array<{ role?: string; content?: unknown }> = [];
	let stderr = "";
	let buffer = "";
	let aborted = false;

	const processLine = (line: string) => {
		if (!line.trim()) return;
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		if (!event || typeof event !== "object") return;
		const record = event as { type?: unknown; message?: unknown };
		if ((record.type === "message_end" || record.type === "tool_result_end") && record.message && typeof record.message === "object") {
			messages.push(record.message as { role?: string; content?: unknown });
		}
	};

	proc.stdout.on("data", (data) => {
		buffer += data.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) processLine(line);
	});
	proc.stderr.on("data", (data) => {
		stderr += data.toString();
	});

	const done = new Promise<ChildResult>((resolve) => {
		proc.on("close", (code) => {
			if (buffer.trim()) processLine(buffer);
			const state = aborted ? "cancelled" : code === 0 ? "completed" : "error";
			const output = state === "completed" ? latestAssistantText(messages) : stderr.trim() || latestAssistantText(messages);
			resolve({ id, state, output, exitCode: code, stderr });
		});
		proc.on("error", (error) => {
			resolve({ id, state: "error", output: String(error), exitCode: 1, stderr });
		});
	});

	const kill = () => {
		aborted = true;
		proc.kill("SIGTERM");
		setTimeout(() => {
			if (!proc.killed) proc.kill("SIGKILL");
		}, 5000).unref();
	};
	if (signal?.aborted) kill();
	else signal?.addEventListener("abort", kill, { once: true });

	const job: Job = { id, agent: agent.id, description, prompt, startedAt: Date.now(), process: proc, done };
	jobs.set(id, job);
	done.finally(() => jobs.delete(id));
	return job;
}

function updateSubagentStatus(ctx: ExtensionContext): void {
	const running = jobs.size;
	ctx.ui.setStatus("subagents", running > 0 ? `⏳ subagents: ${running}` : "");
}

function injectCompletion(pi: ExtensionAPI, ctx: ExtensionContext, job: Job, result: ChildResult): void {
	const escapedDescription = job.description.replace(/"/g, "&quot;");
	pi.sendMessage(
		{
			customType: "subagent-completion",
			content: `<subagent id="${job.id}" agent="${job.agent}" state="${result.state}" description="${escapedDescription}">\n${result.output}\n</subagent>`,
			display: false,
			details: { id: job.id, agent: job.agent, state: result.state, description: job.description },
		},
		{ deliverAs: "followUp", triggerTurn: true },
	);
	updateSubagentStatus(ctx);
}

export default function (pi: ExtensionAPI) {
	config = loadConfig();

	pi.registerTool({
		name: TOOL_NAME,
		label: "Subagent",
		description: [
			"Spawn a configured subagent with fresh context.",
			"Foreground runs to completion and returns the final response.",
			"Background mode returns immediately; completion is injected into the parent conversation automatically but hidden from the UI.",
		].join("\n"),
		parameters: Type.Object({
			agent: Type.String({ description: "Configured subagent id to run" }),
			description: Type.String({ description: "Short description of the subagent task" }),
			prompt: Type.String({ description: "Task for the subagent to perform" }),
			background: Type.Optional(Type.Boolean({ description: "Run in the background and notify when done" })),
		}),
		async execute(_toolCallId, input, signal, _onUpdate, ctx) {
			config = loadConfig(ctx);
			const agent = config.subagents.find((item) => item.id === input.agent);
			if (!agent) {
				const available = config.subagents.map((item) => item.id).join(", ") || "none";
				throw new Error(`Unknown subagent: ${input.agent}. Available subagents: ${available}.`);
			}
			const background = input.background ?? agent.background ?? false;
			const job = startChild(ctx, agent, input.description, input.prompt, signal);
			updateSubagentStatus(ctx);

			if (background) {
				job.done.then((result) => injectCompletion(pi, ctx, job, result)).catch((error) => {
					pi.sendMessage(
						{
							customType: "subagent-completion",
							content: `<subagent id="${job.id}" agent="${job.agent}" state="error" description="${job.description}">\n${String(error)}\n</subagent>`,
							display: false,
							details: { id: job.id, agent: job.agent, state: "error", description: job.description },
						},
						{ deliverAs: "followUp", triggerTurn: true },
					);
					updateSubagentStatus(ctx);
				});
				return {
					content: [{ type: "text", text: BACKGROUND_STARTED }],
					details: { sessionID: job.id, status: "running", agent: agent.id },
					terminate: true,
				};
			}

			const result = await job.done;
			updateSubagentStatus(ctx);
			if (result.state !== "completed") throw new Error(result.output || "Subagent failed.");
			return {
				content: [{ type: "text", text: result.output }],
				details: { sessionID: job.id, status: "completed", agent: agent.id },
			};
		},
		renderResult(result, _options, theme) {
			const details = result.details as { status?: string; agent?: string } | undefined;
			const text = result.content.find((part) => part.type === "text")?.text ?? "";
			if (details?.status === "running") {
				return new Text(`${theme.fg("warning", "⏳")} ${theme.fg("toolTitle", "subagent")} ${theme.fg("muted", "running in background")}`, 0, 0);
			}
			return new Text(text, 0, 0);
		},
	});

	pi.registerCommand("agent", {
		description: "Switch primary agent mode: /agent, /agent next, /agent pi, or /agent <id>",
		handler: async (args, ctx) => {
			config = loadConfig(ctx);
			const value = args.trim();
			if (config.warnings.length) ctx.ui.notify(config.warnings.join("\n"), "warning");
			if (!value) {
				const choice = await ctx.ui.select("Primary agent", ["Pi", ...config.primary.map((agent) => displayName(agent))]);
				if (!choice) return;
				if (choice === "Pi") await switchTo(pi, ctx, undefined);
				else await switchTo(pi, ctx, config.primary.find((agent) => displayName(agent) === choice)?.id);
				return;
			}
			if (value === "next") return cyclePrimary(pi, ctx);
			if (["pi", "default", "off"].includes(value.toLowerCase())) return switchTo(pi, ctx, undefined);
			await switchTo(pi, ctx, value);
		},
	});

	pi.registerCommand("subagents", {
		description: "List configured subagents and running jobs",
		handler: async (_args, ctx) => {
			config = loadConfig(ctx);
			const subagents = config.subagents.map((agent) => `- ${agent.id}: ${agent.description ?? displayName(agent)}`).join("\n") || "none";
			const running = Array.from(jobs.values())
				.map((job) => `- ${job.id} ${job.agent}: ${job.description} (${Math.round((Date.now() - job.startedAt) / 1000)}s)`)
				.join("\n") || "none";
			ctx.ui.notify(`Subagents:\n${subagents}\n\nRunning jobs:\n${running}`, "info");
		},
	});

	pi.registerShortcut(config.cycleKey, {
		description: "Cycle primary agent mode",
		handler: async (ctx) => {
			config = loadConfig(ctx);
			await cyclePrimary(pi, ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig(ctx);
		capturePiDefaults(pi, ctx);
		await applyPrimary(pi, ctx);
		if (config.warnings.length) ctx.ui.notify(config.warnings.join("\n"), "warning");
	});

	pi.on("before_agent_start", (event, ctx) => {
		config = loadConfig(ctx);
		const active = currentPrimary();
		if (!active) return;
		const system = systemText(active, ctx.cwd);
		const subagentList = config.subagents
			.map((agent) => `- ${agent.id}: ${agent.description ?? displayName(agent)}`)
			.join("\n");
		return {
			systemPrompt: `${event.systemPrompt}\n\n# Active primary agent: ${displayName(active)}\n\n${system}${subagentList ? `\n\nAvailable subagents via ${TOOL_NAME}:\n${subagentList}` : ""}`,
		};
	});

	pi.on("session_shutdown", () => {
		for (const job of jobs.values()) job.process.kill("SIGTERM");
		jobs.clear();
	});
}
