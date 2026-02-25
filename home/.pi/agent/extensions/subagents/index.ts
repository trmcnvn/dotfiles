import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  getMarkdownTheme,
  keyHint,
  type AgentToolUpdateCallback,
  type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  buildAvailableSubagentsPrompt,
  listSubagentNames,
  loadSubagents,
  type SubagentConfig,
  type ThinkingLevel,
  type TextVerbosity,
} from "./agents.js";

const CONSULT_SUBAGENT_TOOL = "consult_subagent";
const RUNTIME_EXTENSION_PATH = fileURLToPath(new URL("./runtime.ts", import.meta.url));
const SUBAGENT_PERMISSION_ENV = "PI_SUBAGENT_PERMISSION";
const SUBAGENT_READ_ONLY_ENV = "PI_SUBAGENT_READ_ONLY";
const SUBAGENT_TEMPERATURE_ENV = "PI_SUBAGENT_TEMPERATURE";
const EMPTY_OUTPUT_MESSAGE = "Subagent completed without returning any text.";
const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;

type JsonRecord = Record<string, unknown>;
type SubagentMode = "single" | "parallel" | "chain";

type DisplayItem =
  | {
      readonly type: "text";
      readonly text: string;
    }
  | {
      readonly type: "toolCall";
      readonly name: string;
      readonly args: JsonRecord;
    };

type SubagentUsage = {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly cost: number;
  readonly totalTokens: number;
  readonly turns: number;
};

type TurnUsage = Omit<SubagentUsage, "turns">;

type SingleResult = {
  readonly agent: string;
  readonly task: string;
  readonly exitCode: number;
  readonly displayItems: readonly DisplayItem[];
  readonly finalOutput: string;
  readonly partialText: string | null;
  readonly stderr: string;
  readonly usage: SubagentUsage;
  readonly model: string;
  readonly thinkingLevel: ThinkingLevel;
  readonly temperature: number | null;
  readonly textVerbosity: TextVerbosity | null;
  readonly stopReason: string | null;
  readonly errorMessage: string | null;
  readonly step: number | null;
};

type TaskSpec = {
  readonly agent: string;
  readonly task: string;
  readonly cwd?: string;
};

type SubagentToolDetails = {
  readonly mode: SubagentMode;
  readonly results: readonly SingleResult[];
};

type MutableSingleResult = {
  agent: string;
  task: string;
  exitCode: number;
  displayItems: DisplayItem[];
  finalOutput: string;
  partialText: string | null;
  stderr: string;
  usage: SubagentUsage;
  model: string;
  thinkingLevel: ThinkingLevel;
  temperature: number | null;
  textVerbosity: TextVerbosity | null;
  stopReason: string | null;
  errorMessage: string | null;
  step: number | null;
};

const TaskItem = Type.Object({
  agent: Type.String({
    description: "Subagent name from ~/.pi/agent/agents, for example oracle.",
  }),
  task: Type.String({
    description:
      "Question or task for the subagent. Include the problem, relevant files, and the outcome you want.",
  }),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory for the subagent process. Defaults to the current project root.",
    }),
  ),
});

const ChainItem = Type.Object({
  agent: Type.String({
    description: "Subagent name from ~/.pi/agent/agents, for example oracle.",
  }),
  task: Type.String({
    description:
      "Sequential task. Use {previous} to include the previous step's output.",
  }),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory for the subagent process. Defaults to the current project root.",
    }),
  ),
});

const WebfetchAwareSubagentParams = Type.Object({
  agent: Type.Optional(
    Type.String({
      description: "Subagent name from ~/.pi/agent/agents, for example oracle.",
    }),
  ),
  task: Type.Optional(
    Type.String({
      description:
        "Question or task for the subagent. Include the problem, relevant files, and the outcome you want.",
    }),
  ),
  tasks: Type.Optional(
    Type.Array(TaskItem, {
      description:
        "Parallel subagent tasks. Use for independent investigations that can run concurrently.",
    }),
  ),
  chain: Type.Optional(
    Type.Array(ChainItem, {
      description:
        "Sequential subagent tasks. Later steps can reference prior output with {previous}.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory for the subagent process in single mode. Defaults to the current project root.",
    }),
  ),
});

const EMPTY_USAGE: SubagentUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  totalTokens: 0,
  turns: 0,
};

const EMPTY_TURN_USAGE: TurnUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  totalTokens: 0,
};

const execArgsForTask = (
  config: SubagentConfig,
  task: string,
  model: string,
): readonly string[] => [
  "--mode",
  "json",
  "-p",
  "--no-session",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-themes",
  "--extension",
  RUNTIME_EXTENSION_PATH,
  "--model",
  model,
  "--thinking",
  config.thinkingLevel,
  "--append-system-prompt",
  config.systemPrompt,
  `Task: ${task}`,
];

const formatSessionModel = (model: {
  readonly provider: string;
  readonly id: string;
}): string => `${model.provider}/${model.id}`;

const resolveSubagentModel = (
  config: SubagentConfig,
  sessionModel: string,
): string => config.model ?? sessionModel;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isThinkingLevel = (value: unknown): value is ThinkingLevel =>
  value === "off" ||
  value === "minimal" ||
  value === "low" ||
  value === "medium" ||
  value === "high" ||
  value === "xhigh";

const isTextVerbosity = (value: unknown): value is TextVerbosity =>
  value === "low" || value === "medium" || value === "high";

const isDisplayItem = (value: unknown): value is DisplayItem => {
  if (!isRecord(value) || !isNonEmptyString(value.type)) {
    return false;
  }

  if (value.type === "text") {
    return typeof value.text === "string";
  }

  if (value.type === "toolCall") {
    return isNonEmptyString(value.name) && isRecord(value.args);
  }

  return false;
};

const isUsage = (value: unknown): value is SubagentUsage =>
  isRecord(value) &&
  isFiniteNumber(value.input) &&
  isFiniteNumber(value.output) &&
  isFiniteNumber(value.cacheRead) &&
  isFiniteNumber(value.cacheWrite) &&
  isFiniteNumber(value.cost) &&
  isFiniteNumber(value.totalTokens) &&
  isFiniteNumber(value.turns);

const isSingleResult = (value: unknown): value is SingleResult =>
  isRecord(value) &&
  isNonEmptyString(value.agent) &&
  typeof value.task === "string" &&
  isFiniteNumber(value.exitCode) &&
  Array.isArray(value.displayItems) &&
  value.displayItems.every(isDisplayItem) &&
  typeof value.finalOutput === "string" &&
  (value.partialText === null || typeof value.partialText === "string") &&
  typeof value.stderr === "string" &&
  isUsage(value.usage) &&
  isNonEmptyString(value.model) &&
  isThinkingLevel(value.thinkingLevel) &&
  (value.temperature === null || isFiniteNumber(value.temperature)) &&
  (value.textVerbosity === null || isTextVerbosity(value.textVerbosity)) &&
  (value.stopReason === null || typeof value.stopReason === "string") &&
  (value.errorMessage === null || typeof value.errorMessage === "string") &&
  (value.step === null || isFiniteNumber(value.step));

const isMode = (value: unknown): value is SubagentMode =>
  value === "single" || value === "parallel" || value === "chain";

const parseDetails = (value: unknown): SubagentToolDetails | null => {
  if (!isRecord(value) || !isMode(value.mode) || !Array.isArray(value.results)) {
    return null;
  }

  if (!value.results.every(isSingleResult)) {
    return null;
  }

  return {
    mode: value.mode,
    results: value.results,
  };
};

const parseMetric = (metric: unknown): number =>
  isFiniteNumber(metric) ? metric : 0;

const parseTurnUsage = (value: unknown): TurnUsage => {
  if (!isRecord(value)) {
    return EMPTY_TURN_USAGE;
  }

  const costValue = isRecord(value.cost) ? value.cost : null;

  return {
    input: parseMetric(value.input),
    output: parseMetric(value.output),
    cacheRead: parseMetric(value.cacheRead),
    cacheWrite: parseMetric(value.cacheWrite),
    cost: parseMetric(costValue?.total),
    totalTokens: parseMetric(value.totalTokens),
  };
};

const mergeUsage = (usage: SubagentUsage, turnUsage: TurnUsage): SubagentUsage => ({
  input: usage.input + turnUsage.input,
  output: usage.output + turnUsage.output,
  cacheRead: usage.cacheRead + turnUsage.cacheRead,
  cacheWrite: usage.cacheWrite + turnUsage.cacheWrite,
  cost: usage.cost + turnUsage.cost,
  totalTokens: turnUsage.totalTokens,
  turns: usage.turns + 1,
});

const createMutableResult = (
  config: SubagentConfig,
  task: string,
  step: number | null,
  model: string,
): MutableSingleResult => ({
  agent: config.name,
  task,
  exitCode: -1,
  displayItems: [],
  finalOutput: "",
  partialText: null,
  stderr: "",
  usage: { ...EMPTY_USAGE },
  model,
  thinkingLevel: config.thinkingLevel,
  temperature: config.temperature,
  textVerbosity: config.textVerbosity,
  stopReason: null,
  errorMessage: null,
  step,
});

const snapshotResult = (result: MutableSingleResult): SingleResult => ({
  ...result,
  displayItems: [...result.displayItems],
  usage: { ...result.usage },
});

const createDetails = (
  mode: SubagentMode,
  results: readonly MutableSingleResult[],
): SubagentToolDetails => ({
  mode,
  results: results.map(snapshotResult),
});

const readStringArg = (args: JsonRecord, key: string): string | null => {
  const value = args[key];
  return isNonEmptyString(value) ? value.trim() : null;
};

const readNumberArg = (args: JsonRecord, key: string): number | null => {
  const value = args[key];
  return isFiniteNumber(value) ? value : null;
};

const shortenHomePath = (filePath: string): string => {
  const homePath = homedir();
  return filePath.startsWith(homePath)
    ? `~${filePath.slice(homePath.length)}`
    : filePath;
};

const formatToolCall = (toolName: string, args: JsonRecord): string => {
  switch (toolName) {
    case "bash": {
      const command = readStringArg(args, "command") ?? "...";
      return `$ ${command.length > 60 ? `${command.slice(0, 60)}...` : command}`;
    }

    case "read": {
      const filePath = shortenHomePath(
        readStringArg(args, "path") ?? readStringArg(args, "file_path") ?? "...",
      );
      const offset = readNumberArg(args, "offset");
      const limit = readNumberArg(args, "limit");
      if (offset === null && limit === null) {
        return `read ${filePath}`;
      }
      const startLine = offset ?? 1;
      const endLine = limit === null ? null : startLine + limit - 1;
      return `read ${filePath}:${startLine}${endLine === null ? "" : `-${endLine}`}`;
    }

    case "write": {
      const filePath = shortenHomePath(
        readStringArg(args, "path") ?? readStringArg(args, "file_path") ?? "...",
      );
      const content = readStringArg(args, "content");
      const lineCount = content === null ? 0 : content.split("\n").length;
      return lineCount > 0
        ? `write ${filePath} (${lineCount} lines)`
        : `write ${filePath}`;
    }

    case "edit": {
      const filePath = shortenHomePath(
        readStringArg(args, "path") ?? readStringArg(args, "file_path") ?? "...",
      );
      return `edit ${filePath}`;
    }

    case "ls": {
      const filePath = shortenHomePath(readStringArg(args, "path") ?? ".");
      return `ls ${filePath}`;
    }

    case "find": {
      const pattern = readStringArg(args, "pattern") ?? "*";
      const filePath = shortenHomePath(readStringArg(args, "path") ?? ".");
      return `find ${pattern} in ${filePath}`;
    }

    case "grep": {
      const pattern = readStringArg(args, "pattern") ?? "";
      const filePath = shortenHomePath(readStringArg(args, "path") ?? ".");
      return `grep /${pattern}/ in ${filePath}`;
    }

    case "webfetch": {
      const url = readStringArg(args, "url") ?? "...";
      const objective = readStringArg(args, "objective");
      return objective === null
        ? `webfetch ${url}`
        : `webfetch ${url} (${objective})`;
    }

    default: {
      const json = JSON.stringify(args);
      return json.length > 80 ? `${toolName} ${json.slice(0, 80)}...` : `${toolName} ${json}`;
    }
  }
};

const formatTokens = (count: number): string => {
  if (count < 1000) {
    return count.toString();
  }
  if (count < 10_000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  if (count < 1_000_000) {
    return `${Math.round(count / 1000)}k`;
  }
  return `${(count / 1_000_000).toFixed(1)}M`;
};

const formatUsageStats = (usage: SubagentUsage, model: string): string => {
  const parts: string[] = [];
  if (usage.turns > 0) {
    parts.push(`${usage.turns} turn${usage.turns === 1 ? "" : "s"}`);
  }
  if (usage.input > 0) {
    parts.push(`↑${formatTokens(usage.input)}`);
  }
  if (usage.output > 0) {
    parts.push(`↓${formatTokens(usage.output)}`);
  }
  if (usage.cacheRead > 0) {
    parts.push(`R${formatTokens(usage.cacheRead)}`);
  }
  if (usage.cacheWrite > 0) {
    parts.push(`W${formatTokens(usage.cacheWrite)}`);
  }
  if (usage.cost > 0) {
    parts.push(`$${usage.cost.toFixed(4)}`);
  }
  if (usage.totalTokens > 0) {
    parts.push(`ctx:${formatTokens(usage.totalTokens)}`);
  }
  if (model.trim().length > 0) {
    parts.push(model);
  }
  return parts.join(" ");
};

const extractTextDelta = (value: unknown): string | null => {
  if (!isRecord(value) || value.type !== "text_delta") {
    return null;
  }

  return typeof value.delta === "string" ? value.delta : null;
};

type AssistantMessageData = {
  readonly items: readonly DisplayItem[];
  readonly text: string | null;
  readonly model: string | null;
  readonly stopReason: string | null;
  readonly errorMessage: string | null;
  readonly usage: TurnUsage;
};

const extractAssistantMessage = (value: unknown): AssistantMessageData | null => {
  if (!isRecord(value) || value.role !== "assistant" || !Array.isArray(value.content)) {
    return null;
  }

  const items: DisplayItem[] = [];
  const textParts: string[] = [];

  for (const part of value.content) {
    if (!isRecord(part) || !isNonEmptyString(part.type)) {
      continue;
    }

    if (part.type === "text" && typeof part.text === "string") {
      items.push({ type: "text", text: part.text });
      textParts.push(part.text);
      continue;
    }

    if (part.type === "toolCall" && isNonEmptyString(part.name)) {
      items.push({
        type: "toolCall",
        name: part.name.trim(),
        args: isRecord(part.arguments) ? part.arguments : {},
      });
    }
  }

  return {
    items,
    text: textParts.length > 0 ? textParts.join("\n\n") : null,
    model: isNonEmptyString(value.model) ? value.model.trim() : null,
    stopReason: isNonEmptyString(value.stopReason) ? value.stopReason.trim() : null,
    errorMessage: isNonEmptyString(value.errorMessage)
      ? value.errorMessage.trim()
      : null,
    usage: parseTurnUsage(value.usage),
  };
};

const isRunning = (result: SingleResult | MutableSingleResult): boolean =>
  result.exitCode < 0;

const isFailure = (result: SingleResult | MutableSingleResult): boolean =>
  result.exitCode > 0 ||
  result.stopReason === "error" ||
  result.stopReason === "aborted";

const normalizeOutput = (value: string): string =>
  value.trim().length > 0 ? value : EMPTY_OUTPUT_MESSAGE;

const latestVisibleOutput = (result: SingleResult | MutableSingleResult): string => {
  if (result.partialText !== null && result.partialText.trim().length > 0) {
    return result.partialText;
  }
  if (result.finalOutput.trim().length > 0) {
    return result.finalOutput;
  }
  return EMPTY_OUTPUT_MESSAGE;
};

const failureSummary = (result: SingleResult | MutableSingleResult): string => {
  if (result.errorMessage !== null && result.errorMessage.trim().length > 0) {
    return result.errorMessage;
  }
  if (result.stderr.trim().length > 0) {
    return result.stderr.trim();
  }
  return latestVisibleOutput(result);
};

const buildSinglePartialText = (result: MutableSingleResult): string =>
  latestVisibleOutput(result);

const buildSingleFinalText = (result: SingleResult): string =>
  isFailure(result)
    ? `Subagent ${result.agent} failed (${result.stopReason ?? `exit ${result.exitCode}`}): ${failureSummary(result)}`
    : normalizeOutput(result.finalOutput);

const buildParallelPartialText = (
  results: readonly MutableSingleResult[],
): string => {
  const running = results.filter((result) => isRunning(result)).length;
  const done = results.length - running;
  return `Parallel: ${done}/${results.length} done, ${running} running...`;
};

const buildParallelFinalText = (results: readonly SingleResult[]): string =>
  results
    .map((result) => {
      const heading = `## ${result.agent}`;
      const body = isFailure(result)
        ? `Failed (${result.stopReason ?? `exit ${result.exitCode}`}): ${failureSummary(result)}`
        : normalizeOutput(result.finalOutput);
      return `${heading}\n\n${body}`;
    })
    .join("\n\n");

const buildChainPartialText = (
  totalSteps: number,
  results: readonly MutableSingleResult[],
): string => {
  const current = results[results.length - 1];
  if (current === undefined) {
    return `Chain: 0/${totalSteps} steps complete`;
  }

  return `Chain: step ${results.length}/${totalSteps} (${current.agent}) — ${latestVisibleOutput(current)}`;
};

const buildChainFinalText = (results: readonly SingleResult[]): string => {
  const failedStep = results.find((result) => isFailure(result));
  if (failedStep !== undefined) {
    return `Chain stopped at step ${failedStep.step ?? "?"} (${failedStep.agent}): ${failureSummary(failedStep)}`;
  }

  const last = results[results.length - 1];
  return last === undefined ? EMPTY_OUTPUT_MESSAGE : normalizeOutput(last.finalOutput);
};

const emitToolUpdate = (
  onUpdate: AgentToolUpdateCallback<unknown> | undefined,
  mode: SubagentMode,
  results: readonly MutableSingleResult[],
  text: string,
): void => {
  if (onUpdate === undefined) {
    return;
  }

  onUpdate({
    content: [{ type: "text", text }],
    details: createDetails(mode, results),
  });
};

const requireConfig = (
  subagents: readonly SubagentConfig[],
  name: string,
): SubagentConfig => {
  const normalizedName = name.trim().toLowerCase();
  const config = subagents.find(
    (subagent) => subagent.name.toLowerCase() === normalizedName,
  );

  if (config !== undefined) {
    return config;
  }

  throw new Error(
    `Unknown subagent "${name}". Available subagents: ${listSubagentNames(subagents)}.`,
  );
};

const hasSingleMode = (params: JsonRecord): boolean =>
  isNonEmptyString(params.agent) && isNonEmptyString(params.task);

const hasParallelMode = (params: JsonRecord): boolean =>
  Array.isArray(params.tasks) && params.tasks.length > 0;

const hasChainMode = (params: JsonRecord): boolean =>
  Array.isArray(params.chain) && params.chain.length > 0;

const parseTaskList = (value: unknown): readonly TaskSpec[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const tasks: TaskSpec[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isNonEmptyString(item.agent) || !isNonEmptyString(item.task)) {
      continue;
    }
    tasks.push({
      agent: item.agent.trim(),
      task: item.task,
      cwd: isNonEmptyString(item.cwd) ? item.cwd : undefined,
    });
  }
  return tasks;
};

const mapWithConcurrencyLimit = async <TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  map: (item: TInput, index: number) => Promise<TOutput>,
): Promise<readonly TOutput[]> => {
  if (items.length === 0) {
    return [];
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const results: TOutput[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await map(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
};

const runSingleSubagent = async (
  config: SubagentConfig,
  task: string,
  cwd: string,
  step: number | null,
  sessionModel: string,
  signal: AbortSignal | undefined,
  onUpdate: ((result: SingleResult) => void) | undefined,
): Promise<SingleResult> => {
  const env = { ...process.env };
  if (config.permissions !== null) {
    env[SUBAGENT_PERMISSION_ENV] = JSON.stringify(config.permissions);
  }
  if (config.readOnly) {
    env[SUBAGENT_READ_ONLY_ENV] = "1";
  }
  if (config.temperature !== null) {
    env[SUBAGENT_TEMPERATURE_ENV] = String(config.temperature);
  }

  return new Promise<SingleResult>((resolve, reject) => {
    const resolvedModel = resolveSubagentModel(config, sessionModel);
    const result = createMutableResult(config, task, step, resolvedModel);
    const child = spawn("pi", [...execArgsForTask(config, task, resolvedModel)], {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let aborted = false;

    const pushUpdate = (): void => {
      if (onUpdate === undefined) {
        return;
      }
      onUpdate(snapshotResult(result));
    };

    const handleLine = (line: string): void => {
      if (line.trim().length === 0) {
        return;
      }

      let eventValue: unknown;
      try {
        eventValue = JSON.parse(line);
      } catch {
        return;
      }

      if (!isRecord(eventValue) || !isNonEmptyString(eventValue.type)) {
        return;
      }

      if (eventValue.type === "message_update") {
        const delta = extractTextDelta(eventValue.assistantMessageEvent);
        if (delta !== null) {
          result.partialText = `${result.partialText ?? ""}${delta}`;
          pushUpdate();
        }
        return;
      }

      if (eventValue.type !== "message_end") {
        return;
      }

      const assistantMessage = extractAssistantMessage(eventValue.message);
      if (assistantMessage === null) {
        return;
      }

      result.displayItems.push(...assistantMessage.items);
      if (assistantMessage.text !== null) {
        result.finalOutput = assistantMessage.text;
      }
      result.partialText = null;
      result.model = assistantMessage.model ?? result.model;
      result.stopReason = assistantMessage.stopReason;
      result.errorMessage = assistantMessage.errorMessage;
      result.usage = mergeUsage(result.usage, assistantMessage.usage);
      pushUpdate();
    };

    const terminateChild = (): void => {
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 5_000);
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        handleLine(line);
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      result.stderr += chunk.toString();
      pushUpdate();
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to start subagent process: ${error.message}. Ensure the pi CLI is installed and on PATH.`,
        ),
      );
    });

    child.on("close", (exitCode, signalCode) => {
      if (stdoutBuffer.trim().length > 0) {
        handleLine(stdoutBuffer);
      }

      if (aborted) {
        reject(new Error("Subagent was aborted before it finished."));
        return;
      }

      result.exitCode = exitCode ?? 1;

      if (exitCode === null && signalCode !== null) {
        result.stopReason = result.stopReason ?? "error";
        result.errorMessage =
          result.errorMessage ??
          `Subagent process exited via signal ${signalCode} before returning a final message.`;
      }

      resolve(snapshotResult(result));
    });

    if (signal !== undefined) {
      if (signal.aborted) {
        terminateChild();
      } else {
        signal.addEventListener("abort", terminateChild, { once: true });
      }
    }
  });
};

export default function subagentsExtension(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    const subagents = await loadSubagents();
    const availableSubagentsPrompt = buildAvailableSubagentsPrompt(subagents);
    if (availableSubagentsPrompt === null) {
      return undefined;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${availableSubagentsPrompt}`,
    };
  });

  pi.registerTool({
    name: CONSULT_SUBAGENT_TOOL,
    label: "Consult Subagent",
    description:
      "Consult one or more named subagents from ~/.pi/agent/agents. Each subagent runs in an isolated pi child process with its configured tool permissions. Supports single mode (agent + task), parallel mode (tasks), and chain mode (chain with {previous}).",
    promptSnippet:
      "Consult named subagents for isolated analysis or implementation, optionally in parallel or as a chain.",
    promptGuidelines: [
      "Use this tool when a task would benefit from a deeper isolated pass before you act.",
      "Choose subagents by name from the available subagents listed in the system prompt.",
      "Use single mode by default. Use tasks for independent investigations that can run in parallel.",
      "Use chain when later steps should build on earlier subagent output via {previous}.",
      "Include concrete context in each task: goal, relevant files, suspected issue, constraints, and desired outcome.",
      "Treat subagent output as advisory and decide what to do next yourself.",
    ],
    parameters: WebfetchAwareSubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const subagents = await loadSubagents();
      if (subagents.length === 0) {
        throw new Error(
          "No subagents found in ~/.pi/agent/agents. Add a markdown file with frontmatter and a prompt body, then /reload.",
        );
      }

      const hasSingle = hasSingleMode(params);
      const hasParallel = hasParallelMode(params);
      const hasChain = hasChainMode(params);
      const modeCount = Number(hasSingle) + Number(hasParallel) + Number(hasChain);

      if (modeCount !== 1) {
        throw new Error(
          "Provide exactly one subagent mode: single (agent + task), parallel (tasks), or chain (chain).",
        );
      }

      const activeModel = ctx.model;
      if (activeModel === undefined) {
        throw new Error("No active model is selected for consult_subagent.");
      }

      const sessionModel = formatSessionModel(activeModel);

      if (hasSingle) {
        const agentName = isNonEmptyString(params.agent) ? params.agent : null;
        const taskText = isNonEmptyString(params.task) ? params.task : null;
        if (agentName === null || taskText === null) {
          throw new Error("Single subagent mode requires both agent and task.");
        }

        const config = requireConfig(subagents, agentName);
        const resolvedModel = resolveSubagentModel(config, sessionModel);
        const partialResults: MutableSingleResult[] = [
          createMutableResult(config, taskText, null, resolvedModel),
        ];
        const result = await runSingleSubagent(
          config,
          taskText,
          params.cwd ?? ctx.cwd,
          null,
          sessionModel,
          signal,
          onUpdate === undefined
            ? undefined
            : (partialResult) => {
                partialResults[0] = {
                  ...partialResult,
                  displayItems: [...partialResult.displayItems],
                  usage: { ...partialResult.usage },
                };
                emitToolUpdate(
                  onUpdate,
                  "single",
                  partialResults,
                  buildSinglePartialText(partialResults[0]),
                );
              },
        );

        return {
          content: [{ type: "text", text: buildSingleFinalText(result) }],
          details: createDetails("single", [
            {
              ...result,
              displayItems: [...result.displayItems],
              usage: { ...result.usage },
            },
          ]),
        };
      }

      if (hasParallel) {
        const tasks = parseTaskList(params.tasks);
        if (tasks.length === 0) {
          throw new Error("Parallel mode requires at least one valid task.");
        }
        if (tasks.length > MAX_PARALLEL_TASKS) {
          throw new Error(
            `Too many parallel subagent tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
          );
        }

        const configs = tasks.map((task) => requireConfig(subagents, task.agent));
        const partialResults = tasks.map((task, index) =>
          createMutableResult(
            configs[index],
            task.task,
            null,
            resolveSubagentModel(configs[index], sessionModel),
          ),
        );

        const results = await mapWithConcurrencyLimit(
          tasks,
          MAX_CONCURRENCY,
          async (task, index) => {
            const result = await runSingleSubagent(
              configs[index],
              task.task,
              task.cwd ?? ctx.cwd,
              null,
              sessionModel,
              signal,
              onUpdate === undefined
                ? undefined
                : (partialResult) => {
                    partialResults[index] = {
                      ...partialResult,
                      displayItems: [...partialResult.displayItems],
                      usage: { ...partialResult.usage },
                    };
                    emitToolUpdate(
                      onUpdate,
                      "parallel",
                      partialResults,
                      buildParallelPartialText(partialResults),
                    );
                  },
            );

            partialResults[index] = {
              ...result,
              displayItems: [...result.displayItems],
              usage: { ...result.usage },
            };
            emitToolUpdate(
              onUpdate,
              "parallel",
              partialResults,
              buildParallelPartialText(partialResults),
            );
            return result;
          },
        );

        return {
          content: [{ type: "text", text: buildParallelFinalText(results) }],
          details: {
            mode: "parallel",
            results,
          },
        };
      }

      const chain = parseTaskList(params.chain);
      if (chain.length === 0) {
        throw new Error("Chain mode requires at least one valid step.");
      }

      const results: SingleResult[] = [];
      const partialResults: MutableSingleResult[] = [];
      let previousOutput = "";

      for (let index = 0; index < chain.length; index += 1) {
        const step = chain[index];
        const config = requireConfig(subagents, step.agent);
        const task = step.task.replace(/\{previous\}/g, previousOutput);
        partialResults[index] = createMutableResult(
          config,
          task,
          index + 1,
          resolveSubagentModel(config, sessionModel),
        );

        const result = await runSingleSubagent(
          config,
          task,
          step.cwd ?? ctx.cwd,
          index + 1,
          sessionModel,
          signal,
          onUpdate === undefined
            ? undefined
            : (partialResult) => {
                partialResults[index] = {
                  ...partialResult,
                  displayItems: [...partialResult.displayItems],
                  usage: { ...partialResult.usage },
                };
                emitToolUpdate(
                  onUpdate,
                  "chain",
                  partialResults,
                  buildChainPartialText(chain.length, partialResults),
                );
              },
        );

        results.push(result);
        partialResults[index] = {
          ...result,
          displayItems: [...result.displayItems],
          usage: { ...result.usage },
        };
        emitToolUpdate(
          onUpdate,
          "chain",
          partialResults,
          buildChainPartialText(chain.length, partialResults),
        );

        if (isFailure(result)) {
          return {
            content: [{ type: "text", text: buildChainFinalText(results) }],
            details: {
              mode: "chain",
              results,
            },
          };
        }

        previousOutput = result.finalOutput.trim().length > 0 ? result.finalOutput : "";
      }

      return {
        content: [{ type: "text", text: buildChainFinalText(results) }],
        details: {
          mode: "chain",
          results,
        },
      };
    },

    renderCall(args, theme) {
      const callArgs: JsonRecord = isRecord(args) ? args : {};
      const chain = Array.isArray(callArgs.chain) ? callArgs.chain : [];

      if (chain.length > 0) {
        let text =
          theme.fg("toolTitle", theme.bold("consult_subagent ")) +
          theme.fg("accent", `chain (${chain.length} steps)`);
        for (const [index, item] of chain.slice(0, 3).entries()) {
          if (!isRecord(item)) {
            continue;
          }
          const agent = isNonEmptyString(item.agent) ? item.agent.trim() : "...";
          const task = typeof item.task === "string" ? item.task : "";
          const preview = task.replace(/\{previous\}/g, "").trim();
          const limited = preview.length > 50 ? `${preview.slice(0, 50)}...` : preview;
          text += `\n  ${theme.fg("muted", `${index + 1}.`)} ${theme.fg("accent", agent)} ${theme.fg("dim", limited)}`;
        }
        if (chain.length > 3) {
          text += `\n  ${theme.fg("muted", `... +${chain.length - 3} more`)}`;
        }
        return new Text(text, 0, 0);
      }

      const tasks = Array.isArray(callArgs.tasks) ? callArgs.tasks : [];
      if (tasks.length > 0) {
        let text =
          theme.fg("toolTitle", theme.bold("consult_subagent ")) +
          theme.fg("accent", `parallel (${tasks.length} tasks)`);
        for (const item of tasks.slice(0, 3)) {
          if (!isRecord(item)) {
            continue;
          }
          const agent = isNonEmptyString(item.agent) ? item.agent.trim() : "...";
          const task = typeof item.task === "string" ? item.task : "";
          const preview = task.length > 50 ? `${task.slice(0, 50)}...` : task;
          text += `\n  ${theme.fg("accent", agent)} ${theme.fg("dim", preview)}`;
        }
        if (tasks.length > 3) {
          text += `\n  ${theme.fg("muted", `... +${tasks.length - 3} more`)}`;
        }
        return new Text(text, 0, 0);
      }

      const agent = isNonEmptyString(callArgs.agent) ? callArgs.agent.trim() : "...";
      const task = typeof callArgs.task === "string" ? callArgs.task : "";
      const preview = task.length > 80 ? `${task.slice(0, 80)}...` : task;
      return new Text(
        `${theme.fg("toolTitle", theme.bold("consult_subagent "))}${theme.fg("accent", agent)}\n  ${theme.fg("dim", preview)}`,
        0,
        0,
      );
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = parseDetails(result.details);
      if (details === null || details.results.length === 0) {
        const firstContent = result.content[0];
        const text = firstContent?.type === "text" ? firstContent.text : EMPTY_OUTPUT_MESSAGE;
        return new Text(text, 0, 0);
      }

      const markdownTheme = getMarkdownTheme();
      const expandHint = keyHint("expandTools", "for details");

      const renderDisplayItems = (
        subagentResult: SingleResult,
        limit: number | undefined,
      ): string => {
        const allItems = subagentResult.displayItems;
        const visibleItems = limit === undefined ? allItems : allItems.slice(-limit);
        const skipped = limit === undefined ? 0 : allItems.length - visibleItems.length;
        const lines: string[] = [];

        if (skipped > 0) {
          lines.push(theme.fg("muted", `... ${skipped} earlier items`));
        }

        for (const item of visibleItems) {
          if (item.type === "toolCall") {
            lines.push(
              `${theme.fg("muted", "→ ")}${theme.fg("accent", formatToolCall(item.name, item.args))}`,
            );
            continue;
          }

          const preview = expanded
            ? item.text
            : item.text.split("\n").slice(0, 3).join("\n");
          lines.push(theme.fg("toolOutput", preview));
        }

        if (
          subagentResult.partialText !== null &&
          subagentResult.partialText.trim().length > 0
        ) {
          const partialPreview = expanded
            ? subagentResult.partialText
            : subagentResult.partialText.split("\n").slice(0, 3).join("\n");
          lines.push(
            `${theme.fg("warning", "… ")}${theme.fg("toolOutput", partialPreview)}`,
          );
        }

        return lines.join("\n");
      };

      const addExpandedBody = (
        container: Container,
        subagentResult: SingleResult,
      ): void => {
        container.addChild(
          new Text(
            `${theme.fg("muted", "Task: ")}${theme.fg("dim", subagentResult.task)}`,
            0,
            0,
          ),
        );

        const toolCalls = subagentResult.displayItems.filter(
          (item): item is Extract<DisplayItem, { type: "toolCall" }> =>
            item.type === "toolCall",
        );
        if (toolCalls.length > 0) {
          container.addChild(new Spacer(1));
          for (const toolCall of toolCalls) {
            container.addChild(
              new Text(
                `${theme.fg("muted", "→ ")}${theme.fg("accent", formatToolCall(toolCall.name, toolCall.args))}`,
                0,
                0,
              ),
            );
          }
        }

        const visibleOutput = latestVisibleOutput(subagentResult);
        const shouldRenderOutput =
          visibleOutput !== EMPTY_OUTPUT_MESSAGE ||
          subagentResult.displayItems.some((item) => item.type === "text");
        if (shouldRenderOutput) {
          container.addChild(new Spacer(1));
          if (isRunning(subagentResult)) {
            container.addChild(
              new Text(theme.fg("toolOutput", visibleOutput), 0, 0),
            );
          } else {
            container.addChild(
              new Markdown(normalizeOutput(subagentResult.finalOutput), 0, 0, markdownTheme),
            );
          }
        }

        if (
          isFailure(subagentResult) &&
          subagentResult.stderr.trim().length > 0 &&
          subagentResult.stderr.trim() !== failureSummary(subagentResult)
        ) {
          container.addChild(new Spacer(1));
          container.addChild(
            new Text(theme.fg("error", subagentResult.stderr.trim()), 0, 0),
          );
        }

        const usage = formatUsageStats(subagentResult.usage, subagentResult.model);
        if (usage.length > 0) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("dim", usage), 0, 0));
        }
      };

      const renderCollapsedSingle = (subagentResult: SingleResult): Text => {
        const icon = isRunning(subagentResult)
          ? theme.fg("warning", "⏳")
          : isFailure(subagentResult)
            ? theme.fg("error", "✗")
            : theme.fg("success", "✓");

        let text = `${icon} ${theme.fg("toolTitle", theme.bold(subagentResult.agent))}`;
        if (isFailure(subagentResult)) {
          text += `\n${theme.fg("error", failureSummary(subagentResult))}`;
        } else {
          const display = renderDisplayItems(subagentResult, COLLAPSED_ITEM_COUNT);
          text += `\n${display.length > 0 ? display : theme.fg("muted", isRunning(subagentResult) ? "(running...)" : "(no output)")}`;
        }

        const usage = formatUsageStats(subagentResult.usage, subagentResult.model);
        if (usage.length > 0) {
          text += `\n${theme.fg("dim", usage)}`;
        }

        if (
          !expanded &&
          (subagentResult.displayItems.length > COLLAPSED_ITEM_COUNT ||
            normalizeOutput(subagentResult.finalOutput).split("\n").length > 3)
        ) {
          text += `\n${theme.fg("muted", `(${expandHint})`)}`;
        }

        return new Text(text, 0, 0);
      };

      if (details.mode === "single") {
        const subagentResult = details.results[0];
        if (!expanded && !isPartial) {
          return renderCollapsedSingle(subagentResult);
        }

        const icon = isRunning(subagentResult)
          ? theme.fg("warning", "⏳")
          : isFailure(subagentResult)
            ? theme.fg("error", "✗")
            : theme.fg("success", "✓");
        const container = new Container();
        container.addChild(
          new Text(
            `${icon} ${theme.fg("toolTitle", theme.bold(subagentResult.agent))}`,
            0,
            0,
          ),
        );
        if (isFailure(subagentResult)) {
          container.addChild(new Spacer(1));
          container.addChild(
            new Text(theme.fg("error", failureSummary(subagentResult)), 0, 0),
          );
        }
        container.addChild(new Spacer(1));
        addExpandedBody(container, subagentResult);
        return container;
      }

      if (details.mode === "parallel") {
        const running = details.results.filter((subagentResult) => isRunning(subagentResult)).length;
        const failures = details.results.filter((subagentResult) => isFailure(subagentResult)).length;
        const successes = details.results.filter(
          (subagentResult) => !isRunning(subagentResult) && !isFailure(subagentResult),
        ).length;
        const icon = running > 0
          ? theme.fg("warning", "⏳")
          : failures > 0
            ? theme.fg("warning", "◐")
            : theme.fg("success", "✓");
        const header = running > 0
          ? `${successes + failures}/${details.results.length} done, ${running} running`
          : `${successes}/${details.results.length} tasks`;

        if (!expanded) {
          let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", header)}`;
          for (const subagentResult of details.results) {
            const lineIcon = isRunning(subagentResult)
              ? theme.fg("warning", "⏳")
              : isFailure(subagentResult)
                ? theme.fg("error", "✗")
                : theme.fg("success", "✓");
            const display = renderDisplayItems(subagentResult, 5);
            text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", subagentResult.agent)} ${lineIcon}`;
            text += `\n${display.length > 0 ? display : theme.fg("muted", isRunning(subagentResult) ? "(running...)" : "(no output)")}`;
          }
          if (!expanded) {
            text += `\n${theme.fg("muted", `(${expandHint})`)}`;
          }
          return new Text(text, 0, 0);
        }

        const container = new Container();
        container.addChild(
          new Text(
            `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", header)}`,
            0,
            0,
          ),
        );

        for (const subagentResult of details.results) {
          const lineIcon = isRunning(subagentResult)
            ? theme.fg("warning", "⏳")
            : isFailure(subagentResult)
              ? theme.fg("error", "✗")
              : theme.fg("success", "✓");
          container.addChild(new Spacer(1));
          container.addChild(
            new Text(
              `${theme.fg("muted", "─── ")}${theme.fg("accent", subagentResult.agent)} ${lineIcon}`,
              0,
              0,
            ),
          );
          addExpandedBody(container, subagentResult);
        }

        return container;
      }

      const completedSteps = details.results.filter(
        (subagentResult) => !isRunning(subagentResult) && !isFailure(subagentResult),
      ).length;
      const chainFailed = details.results.some((subagentResult) => isFailure(subagentResult));
      const chainRunning = details.results.some((subagentResult) => isRunning(subagentResult));
      const chainIcon = chainRunning
        ? theme.fg("warning", "⏳")
        : chainFailed
          ? theme.fg("error", "✗")
          : theme.fg("success", "✓");
      const chainHeader = chainRunning
        ? `${completedSteps}/${details.results.length} steps complete`
        : `${completedSteps}/${details.results.length} steps`;

      if (!expanded) {
        let text = `${chainIcon} ${theme.fg("toolTitle", theme.bold("chain "))}${theme.fg("accent", chainHeader)}`;
        for (const subagentResult of details.results) {
          const lineIcon = isRunning(subagentResult)
            ? theme.fg("warning", "⏳")
            : isFailure(subagentResult)
              ? theme.fg("error", "✗")
              : theme.fg("success", "✓");
          text += `\n\n${theme.fg("muted", `─── Step ${subagentResult.step ?? "?"}: `)}${theme.fg("accent", subagentResult.agent)} ${lineIcon}`;
          const display = renderDisplayItems(subagentResult, 5);
          text += `\n${display.length > 0 ? display : theme.fg("muted", isRunning(subagentResult) ? "(running...)" : "(no output)")}`;
        }
        if (!expanded) {
          text += `\n${theme.fg("muted", `(${expandHint})`)}`;
        }
        return new Text(text, 0, 0);
      }

      const container = new Container();
      container.addChild(
        new Text(
          `${chainIcon} ${theme.fg("toolTitle", theme.bold("chain "))}${theme.fg("accent", chainHeader)}`,
          0,
          0,
        ),
      );

      for (const subagentResult of details.results) {
        const lineIcon = isRunning(subagentResult)
          ? theme.fg("warning", "⏳")
          : isFailure(subagentResult)
            ? theme.fg("error", "✗")
            : theme.fg("success", "✓");
        container.addChild(new Spacer(1));
        container.addChild(
          new Text(
            `${theme.fg("muted", `─── Step ${subagentResult.step ?? "?"}: `)}${theme.fg("accent", subagentResult.agent)} ${lineIcon}`,
            0,
            0,
          ),
        );
        addExpandedBody(container, subagentResult);
      }

      return container;
    },
  });
}
