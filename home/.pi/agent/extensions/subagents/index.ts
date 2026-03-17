import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  getMarkdownTheme,
  keyHint,
  truncateHead,
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
import {
  assertChainReadPathsExist,
  buildChainTask,
  createChainDir,
  expandChainTaskTemplate,
  resolveChainOutputPath,
  resolveChainReadPaths,
  resolveChainTaskTemplate,
  writeChainOutput,
} from "./chain.js";
import {
  findAsyncDir,
  launchAsyncSubagent,
  readAsyncResult,
  readAsyncStatus,
} from "./async.js";
import {
  readSkillSelection,
  resolveSelectedSkillNames,
  resolveSkillPaths,
  type SkillSelection,
} from "./skills.js";

const CONSULT_SUBAGENT_TOOL = "consult_subagent";
const SUBAGENT_STATUS_TOOL = "subagent_status";
const RUNTIME_EXTENSION_PATH = fileURLToPath(new URL("./runtime.ts", import.meta.url));
const SUBAGENT_PERMISSION_ENV = "PI_SUBAGENT_PERMISSION";
const SUBAGENT_READ_ONLY_ENV = "PI_SUBAGENT_READ_ONLY";
const SUBAGENT_TEMPERATURE_ENV = "PI_SUBAGENT_TEMPERATURE";
const EMPTY_OUTPUT_MESSAGE = "Subagent completed without returning any text.";
const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;
const SUBAGENT_TEMP_OUTPUT_PREFIX = "pi-subagent-";
const SUBAGENT_INTERNAL_SESSION_ROOT = join(
  homedir(),
  ".pi",
  "agent",
  "internal",
  "subagents",
);
const SUBAGENT_SESSION_METADATA_FILE = "metadata.json";
const SUBAGENT_COLLAPSED_PREVIEW_LINES = 12;

type TruncatedOutput = {
  readonly text: string;
  readonly truncated: boolean;
  readonly fullOutputPath: string | null;
};

type JsonRecord = Record<string, unknown>;
type ActiveModel = {
  readonly provider: string;
  readonly id: string;
};
type SubagentMode = "single" | "parallel" | "chain";
type SubagentOutputMode = "full" | "collapsed" | "summary";

type PersistedSubagentMetadata = {
  readonly version: 1;
  readonly agent: string;
  readonly cwd: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type SubagentSessionHandle = {
  readonly sessionId: string;
  readonly sessionDir: string;
  readonly sessionFile: string | null;
};

type ResolvedSubagentSession = {
  readonly cwd: string;
  readonly handle: SubagentSessionHandle | null;
};

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
  readonly sessionId: string | null;
  readonly sessionFile: string | null;
};

type TaskSpec = {
  readonly agent: string;
  readonly task: string;
  readonly cwd?: string;
  readonly model?: string;
  readonly skillSelection: SkillSelection;
};

type ChainStepSpec = {
  readonly agent: string;
  readonly task: string | null;
  readonly cwd?: string;
  readonly model?: string;
  readonly skillSelection: SkillSelection;
  readonly output?: string;
  readonly reads: readonly string[];
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
  sessionId: string | null;
  sessionFile: string | null;
};

const SkillOverrideParam = Type.Union([
  Type.String(),
  Type.Array(Type.String()),
  Type.Literal(false),
]);

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
  model: Type.Optional(
    Type.String({
      description: "Optional model override for this task.",
    }),
  ),
  skill: Type.Optional(SkillOverrideParam),
  skills: Type.Optional(SkillOverrideParam),
});

const ChainItem = Type.Object({
  agent: Type.String({
    description: "Subagent name from ~/.pi/agent/agents, for example oracle.",
  }),
  task: Type.Optional(
    Type.String({
      description:
        "Sequential task. Supports {task}, {previous}, and {chain_dir}. Defaults to {task} for the first step and {previous} afterwards.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory for the subagent process. Defaults to the current project root.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description: "Optional model override for this step.",
    }),
  ),
  skill: Type.Optional(SkillOverrideParam),
  skills: Type.Optional(SkillOverrideParam),
  output: Type.Optional(
    Type.String({
      description: "Optional output file written by the parent extension after this step completes.",
    }),
  ),
  reads: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional chain artifact files to read before this step runs.",
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
        "Question or task for the subagent. In chain mode this is the original task available as {task}.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description: "Optional model override for single mode.",
    }),
  ),
  skill: Type.Optional(SkillOverrideParam),
  skills: Type.Optional(SkillOverrideParam),
  tasks: Type.Optional(
    Type.Array(TaskItem, {
      description:
        "Parallel subagent tasks. Use for independent investigations that can run concurrently.",
    }),
  ),
  chain: Type.Optional(
    Type.Array(ChainItem, {
      description:
        "Sequential subagent tasks. Later steps can reference prior output with {previous} and shared artifacts with {chain_dir}.",
    }),
  ),
  chainDir: Type.Optional(
    Type.String({
      description:
        "Optional shared directory for chain artifacts. Relative paths resolve against the current working directory.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory for the subagent process in single mode. Defaults to the current project root.",
    }),
  ),
  async: Type.Optional(
    Type.Boolean({
      description: "Run in the background and inspect progress later with subagent_status.",
    }),
  ),
  persist: Type.Optional(
    Type.Boolean({
      description:
        "Persist child session state in isolated internal storage. Default: false (ephemeral).",
    }),
  ),
  sessionId: Type.Optional(
    Type.String({
      description:
        "Resume a previously persisted single-mode subagent session by its internal session handle.",
    }),
  ),
  outputMode: Type.Optional(
    Type.String({
      description:
        'How much subagent output to return to the parent context: "full", "collapsed", or "summary". Default: "full".',
    }),
  ),
});

const SubagentStatusParams = Type.Object({
  id: Type.Optional(
    Type.String({
      description: "Background run id returned by consult_subagent when async is true.",
    }),
  ),
  dir: Type.Optional(
    Type.String({
      description: "Explicit async run directory under ~/.pi/agent/internal/subagents/async/.",
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

const baseExecArgsForTask = (
  config: SubagentConfig,
  model: string,
  skillPaths: readonly string[],
): string[] => {
  const args = [
    "--mode",
    "json",
    "-p",
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
  ];

  for (const skillPath of skillPaths) {
    args.push("--skill", skillPath);
  }

  return args;
};

const execArgsForTask = (
  config: SubagentConfig,
  task: string,
  model: string,
  skillPaths: readonly string[],
  sessionHandle: SubagentSessionHandle | null,
): readonly string[] => {
  const args = baseExecArgsForTask(config, model, skillPaths);

  if (sessionHandle === null) {
    args.push("--no-session");
  } else {
    args.push("--session-dir", sessionHandle.sessionDir);
    if (sessionHandle.sessionFile !== null) {
      args.push("--session", sessionHandle.sessionFile);
    }
  }

  args.push(`Task: ${task}`);
  return args;
};

const formatSessionModel = (model: ActiveModel): string =>
  `${model.provider}/${model.id}`;

const resolveSubagentModel = (
  config: SubagentConfig,
  sessionModel: string,
  modelOverride?: string,
): string => modelOverride ?? config.model ?? sessionModel;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isSubagentOutputMode = (value: unknown): value is SubagentOutputMode =>
  value === "full" || value === "collapsed" || value === "summary";

const parseSubagentOutputMode = (value: unknown): SubagentOutputMode => {
  if (!isNonEmptyString(value)) {
    return "full";
  }

  const normalizedValue = value.trim().toLowerCase();
  return isSubagentOutputMode(normalizedValue) ? normalizedValue : "full";
};

const assertSessionId = (value: string): string => {
  const trimmedValue = value.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmedValue)) {
    throw new Error(
      `Invalid subagent sessionId "${value}". Use the sessionId returned by consult_subagent details.`,
    );
  }

  return trimmedValue;
};

const getMetadataFilePath = (sessionDir: string): string =>
  join(sessionDir, SUBAGENT_SESSION_METADATA_FILE);

const ensureSubagentSessionRoot = async (): Promise<void> => {
  await mkdir(SUBAGENT_INTERNAL_SESSION_ROOT, { recursive: true });
};

const parsePersistedSubagentMetadata = (
  value: unknown,
): PersistedSubagentMetadata | null => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isNonEmptyString(value.agent) ||
    !isNonEmptyString(value.cwd) ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.updatedAt)
  ) {
    return null;
  }

  return {
    version: 1,
    agent: value.agent.trim(),
    cwd: value.cwd.trim(),
    createdAt: value.createdAt.trim(),
    updatedAt: value.updatedAt.trim(),
  };
};

const readPersistedSubagentMetadata = async (
  sessionDir: string,
): Promise<PersistedSubagentMetadata | null> => {
  try {
    const rawMetadata = await readFile(getMetadataFilePath(sessionDir), "utf8");
    return parsePersistedSubagentMetadata(JSON.parse(rawMetadata));
  } catch {
    return null;
  }
};

const writePersistedSubagentMetadata = async (
  handle: SubagentSessionHandle,
  agent: string,
  cwd: string,
): Promise<void> => {
  const previousMetadata = await readPersistedSubagentMetadata(handle.sessionDir);
  const createdAt = previousMetadata?.createdAt ?? new Date().toISOString();
  const metadata: PersistedSubagentMetadata = {
    version: 1,
    agent,
    cwd,
    createdAt,
    updatedAt: new Date().toISOString(),
  };

  await mkdir(handle.sessionDir, { recursive: true });
  await writeFile(
    getMetadataFilePath(handle.sessionDir),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
};

const findPersistedSessionFile = async (sessionDir: string): Promise<string | null> => {
  let entries: readonly string[];
  try {
    entries = await readdir(sessionDir);
  } catch {
    return null;
  }

  const sessionFiles = entries
    .filter((entry) => entry.endsWith(".jsonl"))
    .sort((left, right) => right.localeCompare(left));

  const newestSessionFile = sessionFiles[0];
  return newestSessionFile === undefined ? null : join(sessionDir, newestSessionFile);
};

const createSubagentSessionHandle = async (): Promise<SubagentSessionHandle> => {
  await ensureSubagentSessionRoot();

  const sessionId = randomUUID();
  const sessionDir = join(SUBAGENT_INTERNAL_SESSION_ROOT, sessionId);
  await mkdir(sessionDir, { recursive: true });

  return {
    sessionId,
    sessionDir,
    sessionFile: null,
  };
};

const loadSubagentSessionHandle = async (
  rawSessionId: string,
): Promise<SubagentSessionHandle> => {
  await ensureSubagentSessionRoot();

  const sessionId = assertSessionId(rawSessionId);
  const sessionDir = join(SUBAGENT_INTERNAL_SESSION_ROOT, sessionId);
  const sessionFile = await findPersistedSessionFile(sessionDir);

  if (sessionFile === null) {
    throw new Error(
      `Unknown subagent sessionId "${sessionId}". It may have been deleted or never persisted successfully.`,
    );
  }

  return {
    sessionId,
    sessionDir,
    sessionFile,
  };
};

const finalizeSubagentSessionHandle = async (
  handle: SubagentSessionHandle,
  agent: string,
  cwd: string,
): Promise<SubagentSessionHandle> => {
  const sessionFile = await findPersistedSessionFile(handle.sessionDir);
  if (sessionFile === null) {
    throw new Error(
      `Persisted subagent session ${handle.sessionId} did not create a session file in ${handle.sessionDir}.`,
    );
  }

  const finalizedHandle = {
    ...handle,
    sessionFile,
  };
  await writePersistedSubagentMetadata(finalizedHandle, agent, cwd);
  return finalizedHandle;
};

const resolveSingleModeSession = async (
  config: SubagentConfig,
  requestedCwd: string | undefined,
  fallbackCwd: string,
  rawSessionId: string | null,
  persist: boolean,
): Promise<ResolvedSubagentSession> => {
  if (rawSessionId !== null) {
    const handle = await loadSubagentSessionHandle(rawSessionId);
    const metadata = await readPersistedSubagentMetadata(handle.sessionDir);

    if (metadata !== null && metadata.agent !== config.name) {
      throw new Error(
        `Subagent session ${handle.sessionId} belongs to ${metadata.agent}, not ${config.name}. Start a new session or use the matching agent.`,
      );
    }

    const resolvedCwd = metadata?.cwd ?? requestedCwd ?? fallbackCwd;
    if (requestedCwd !== undefined && requestedCwd !== resolvedCwd) {
      throw new Error(
        `Subagent session ${handle.sessionId} was created for cwd ${resolvedCwd}. Omit cwd to reuse it, or start a new session.`,
      );
    }

    return {
      cwd: resolvedCwd,
      handle,
    };
  }

  return {
    cwd: requestedCwd ?? fallbackCwd,
    handle: persist ? await createSubagentSessionHandle() : null,
  };
};

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
  sessionHandle: SubagentSessionHandle | null,
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
  sessionId: sessionHandle?.sessionId ?? null,
  sessionFile: sessionHandle?.sessionFile ?? null,
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

const truncateAndPersistOutput = async (
  value: string,
): Promise<TruncatedOutput> => {
  const truncation = truncateHead(value, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return {
      text: truncation.content,
      truncated: false,
      fullOutputPath: null,
    };
  }

  const omittedLines = truncation.totalLines - truncation.outputLines;
  const omittedBytes = truncation.totalBytes - truncation.outputBytes;

  let fullOutputPath: string | null = null;
  try {
    const tempDir = await mkdtemp(join(tmpdir(), SUBAGENT_TEMP_OUTPUT_PREFIX));
    fullOutputPath = join(tempDir, "output.txt");
    await writeFile(fullOutputPath, value, "utf8");
  } catch {
    fullOutputPath = null;
  }

  const truncationNotice =
    fullOutputPath === null
      ? `Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ${omittedLines} lines (${formatSize(omittedBytes)}) omitted. Could not persist full output to a temp file.`
      : `Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ${omittedLines} lines (${formatSize(omittedBytes)}) omitted. Full output saved to: ${fullOutputPath}`;

  return {
    text: `${truncation.content}\n\n[${truncationNotice}]`,
    truncated: true,
    fullOutputPath,
  };
};

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

const buildSingleFullText = (result: SingleResult): string =>
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

const buildParallelFullText = (results: readonly SingleResult[]): string =>
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

const buildChainFullText = (results: readonly SingleResult[]): string => {
  const failedStep = results.find((result) => isFailure(result));
  if (failedStep !== undefined) {
    return `Chain stopped at step ${failedStep.step ?? "?"} (${failedStep.agent}): ${failureSummary(failedStep)}`;
  }

  const last = results[results.length - 1];
  return last === undefined ? EMPTY_OUTPUT_MESSAGE : normalizeOutput(last.finalOutput);
};

const collapseDelegatedText = (value: string): string => {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return EMPTY_OUTPUT_MESSAGE;
  }

  const lines = trimmedValue.split("\n");
  if (lines.length <= SUBAGENT_COLLAPSED_PREVIEW_LINES) {
    return trimmedValue;
  }

  return `${lines.slice(0, SUBAGENT_COLLAPSED_PREVIEW_LINES).join("\n")}\n... ${lines.length - SUBAGENT_COLLAPSED_PREVIEW_LINES} more lines`;
};

const buildSingleSummaryText = (result: SingleResult): string =>
  isFailure(result)
    ? `Subagent ${result.agent} failed (${result.stopReason ?? `exit ${result.exitCode}`}): ${failureSummary(result)}`
    : `Subagent ${result.agent} completed successfully.`;

const buildParallelSummaryText = (results: readonly SingleResult[]): string => {
  const successfulResults = results.filter((result) => !isFailure(result)).length;
  const lines = [`Parallel: ${successfulResults}/${results.length} subagents succeeded.`];

  for (const result of results) {
    lines.push(
      `- ${result.agent}: ${isFailure(result) ? `failed (${result.stopReason ?? `exit ${result.exitCode}`})` : "completed"}`,
    );
  }

  return lines.join("\n");
};

const buildChainSummaryText = (results: readonly SingleResult[]): string => {
  const failedStep = results.find((result) => isFailure(result));
  if (failedStep !== undefined) {
    return `Chain stopped at step ${failedStep.step ?? "?"} (${failedStep.agent}): ${failureSummary(failedStep)}`;
  }

  const last = results[results.length - 1];
  return last === undefined
    ? EMPTY_OUTPUT_MESSAGE
    : `Chain completed ${results.length}/${results.length} steps. Final agent: ${last.agent}.`;
};

const buildSessionHandleText = (
  mode: SubagentMode,
  results: readonly SingleResult[],
): string | null => {
  const persistedResults = results.filter(
    (result): result is SingleResult & { readonly sessionId: string } =>
      result.sessionId !== null,
  );

  if (persistedResults.length === 0) {
    return null;
  }

  if (mode === "single") {
    return `sessionId: ${persistedResults[0].sessionId}`;
  }

  const lines = ["sessionIds:"];
  for (const result of persistedResults) {
    const label =
      mode === "chain"
        ? `step ${result.step ?? "?"} ${result.agent}`
        : result.agent;
    lines.push(`- ${label}: ${result.sessionId}`);
  }

  return lines.join("\n");
};

const buildFinalOutputText = (
  mode: SubagentMode,
  results: readonly SingleResult[],
  outputMode: SubagentOutputMode,
): string => {
  const fullText =
    mode === "single"
      ? buildSingleFullText(results[0] ?? {
          agent: "subagent",
          task: "",
          exitCode: 1,
          displayItems: [],
          finalOutput: "",
          partialText: null,
          stderr: "",
          usage: { ...EMPTY_USAGE },
          model: "",
          thinkingLevel: "medium",
          temperature: null,
          textVerbosity: null,
          stopReason: "error",
          errorMessage: EMPTY_OUTPUT_MESSAGE,
          step: null,
          sessionId: null,
          sessionFile: null,
        })
      : mode === "parallel"
        ? buildParallelFullText(results)
        : buildChainFullText(results);

  const baseText =
    outputMode === "full"
      ? fullText
      : outputMode === "collapsed"
        ? collapseDelegatedText(fullText)
        : mode === "single"
          ? buildSingleSummaryText(results[0] ?? {
              agent: "subagent",
              task: "",
              exitCode: 1,
              displayItems: [],
              finalOutput: "",
              partialText: null,
              stderr: "",
              usage: { ...EMPTY_USAGE },
              model: "",
              thinkingLevel: "medium",
              temperature: null,
              textVerbosity: null,
              stopReason: "error",
              errorMessage: EMPTY_OUTPUT_MESSAGE,
              step: null,
              sessionId: null,
              sessionFile: null,
            })
          : mode === "parallel"
            ? buildParallelSummaryText(results)
            : buildChainSummaryText(results);

  const sessionHandleText = buildSessionHandleText(mode, results);
  return sessionHandleText === null ? baseText : `${baseText}\n\n${sessionHandleText}`;
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

const parseModelOverride = (value: unknown, label: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${label}.model must be a non-empty string when provided.`);
  }

  return value.trim();
};

const parseReadsList = (value: unknown, label: string): readonly string[] => {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label}.reads must be an array of file paths.`);
  }

  const reads: string[] = [];
  for (const item of value) {
    if (!isNonEmptyString(item)) {
      throw new Error(`${label}.reads must contain only non-empty strings.`);
    }
    reads.push(item.trim());
  }

  return reads;
};

const parseTaskList = (value: unknown): readonly TaskSpec[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const tasks: TaskSpec[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || !isNonEmptyString(item.agent) || !isNonEmptyString(item.task)) {
      continue;
    }

    tasks.push({
      agent: item.agent.trim(),
      task: item.task,
      cwd: isNonEmptyString(item.cwd) ? item.cwd.trim() : undefined,
      model: parseModelOverride(item.model, `tasks[${index}]`),
      skillSelection: readSkillSelection(item.skill, item.skills, `tasks[${index}]`),
    });
  }
  return tasks;
};

const parseChainSteps = (value: unknown): readonly ChainStepSpec[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const steps: ChainStepSpec[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || !isNonEmptyString(item.agent)) {
      continue;
    }

    steps.push({
      agent: item.agent.trim(),
      task: isNonEmptyString(item.task) ? item.task : null,
      cwd: isNonEmptyString(item.cwd) ? item.cwd.trim() : undefined,
      model: parseModelOverride(item.model, `chain[${index}]`),
      skillSelection: readSkillSelection(item.skill, item.skills, `chain[${index}]`),
      output: isNonEmptyString(item.output) ? item.output.trim() : undefined,
      reads: parseReadsList(item.reads, `chain[${index}]`),
    });
  }
  return steps;
};

const extractResultText = (value: unknown): string | null => {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    return null;
  }

  const firstText = value.content.find(
    (item): item is { readonly type: string; readonly text: string } =>
      isRecord(item) && item.type === "text" && typeof item.text === "string",
  );

  return firstText?.text ?? null;
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
  modelOverride: string | undefined,
  skillPaths: readonly string[],
  sessionHandle: SubagentSessionHandle | null,
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

  return await new Promise<SingleResult>((resolve, reject) => {
    const resolvedModel = resolveSubagentModel(config, sessionModel, modelOverride);
    const result = createMutableResult(config, task, step, resolvedModel, sessionHandle);
    const child = spawn(
      "pi",
      [...execArgsForTask(config, task, resolvedModel, skillPaths, sessionHandle)],
      {
        cwd,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

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

    child.on("close", async (exitCode, signalCode) => {
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

      try {
        if (sessionHandle !== null) {
          const finalizedHandle = await finalizeSubagentSessionHandle(
            sessionHandle,
            config.name,
            cwd,
          );
          result.sessionId = finalizedHandle.sessionId;
          result.sessionFile = finalizedHandle.sessionFile;
        }

        resolve(snapshotResult(result));
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error(`Failed to persist subagent session metadata: ${String(error)}`),
        );
      }
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

export type ConsultSubagentExecutionContext = {
  readonly cwd: string;
  readonly model: ActiveModel | undefined;
};

type SubagentToolResult = {
  readonly content: Array<{ readonly type: "text"; readonly text: string }>;
  readonly details: unknown;
  readonly isError?: boolean;
};

export const executeConsultSubagentSync = async (
  params: JsonRecord,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<unknown> | undefined,
  ctx: ConsultSubagentExecutionContext,
): Promise<SubagentToolResult> => {
  const subagents = await loadSubagents(ctx.cwd);
  if (subagents.length === 0) {
    throw new Error(
      "No subagents found in ~/.pi/agent/agents or the nearest .pi/agents. Add a markdown file with frontmatter and a prompt body, then /reload.",
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

  const outputMode = parseSubagentOutputMode(params.outputMode);
  const rawSessionId = isNonEmptyString(params.sessionId)
    ? params.sessionId.trim()
    : null;
  const persist = params.persist === true || rawSessionId !== null;

  if (rawSessionId !== null && !hasSingle) {
    throw new Error(
      "sessionId can only be used with single subagent mode (agent + task).",
    );
  }

  if (!hasSingle && params.model !== undefined) {
    throw new Error("Top-level model override is only supported in single subagent mode.");
  }

  if (!hasSingle && (params.skill !== undefined || params.skills !== undefined)) {
    throw new Error(
      "Top-level skill overrides are only supported in single subagent mode.",
    );
  }

  if (!hasChain && isNonEmptyString(params.chainDir)) {
    throw new Error("chainDir is only supported in chain mode.");
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
    const session = await resolveSingleModeSession(
      config,
      isNonEmptyString(params.cwd) ? params.cwd.trim() : undefined,
      ctx.cwd,
      rawSessionId,
      persist,
    );
    const modelOverride = parseModelOverride(params.model, "params");
    const skillSelection = readSkillSelection(params.skill, params.skills, "params");
    const skillNames = resolveSelectedSkillNames(config.skills, skillSelection);
    const skillPaths = await resolveSkillPaths(session.cwd, skillNames);
    const resolvedModel = resolveSubagentModel(config, sessionModel, modelOverride);
    const partialResults: MutableSingleResult[] = [
      createMutableResult(config, taskText, null, resolvedModel, session.handle),
    ];
    const result = await runSingleSubagent(
      config,
      taskText,
      session.cwd,
      null,
      sessionModel,
      modelOverride,
      skillPaths,
      session.handle,
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

    const truncatedOutput = await truncateAndPersistOutput(
      buildFinalOutputText("single", [result], outputMode),
    );

    return {
      content: [{ type: "text", text: truncatedOutput.text }],
      details: {
        ...createDetails("single", [
          {
            ...result,
            displayItems: [...result.displayItems],
            usage: { ...result.usage },
          },
        ]),
        outputMode,
        sessionId: result.sessionId,
        sessionFile: result.sessionFile,
        truncated: truncatedOutput.truncated,
        fullOutputPath: truncatedOutput.fullOutputPath,
      },
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
    const taskSkillPaths = await Promise.all(
      tasks.map(async (task, index) => {
        const resolvedCwd = task.cwd ?? ctx.cwd;
        const skillNames = resolveSelectedSkillNames(
          configs[index].skills,
          task.skillSelection,
        );
        return await resolveSkillPaths(resolvedCwd, skillNames);
      }),
    );
    const sessionHandles = persist
      ? await Promise.all(tasks.map(async () => await createSubagentSessionHandle()))
      : tasks.map(() => null);
    const partialResults = tasks.map((task, index) =>
      createMutableResult(
        configs[index],
        task.task,
        null,
        resolveSubagentModel(configs[index], sessionModel, task.model),
        sessionHandles[index],
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
          task.model,
          taskSkillPaths[index],
          sessionHandles[index],
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

    const truncatedOutput = await truncateAndPersistOutput(
      buildFinalOutputText("parallel", results, outputMode),
    );

    return {
      content: [{ type: "text", text: truncatedOutput.text }],
      details: {
        mode: "parallel",
        results,
        outputMode,
        truncated: truncatedOutput.truncated,
        fullOutputPath: truncatedOutput.fullOutputPath,
      },
    };
  }

  const chain = parseChainSteps(params.chain);
  if (chain.length === 0) {
    throw new Error("Chain mode requires at least one valid step.");
  }

  const topLevelTask = isNonEmptyString(params.task) ? params.task : null;
  if (topLevelTask === null && (chain[0]?.task ?? "").includes("{task}")) {
    throw new Error(
      "Chain mode cannot resolve {task} without a top-level task. Pass task at the top level or remove {task} from the first step.",
    );
  }

  const originalTask = topLevelTask ?? chain[0]?.task ?? "";
  if (originalTask.trim().length === 0) {
    throw new Error(
      "Chain mode requires a top-level task or a first step task so {task} can be resolved.",
    );
  }

  const chainDir = await createChainDir(
    isNonEmptyString(params.chainDir) ? params.chainDir.trim() : undefined,
    ctx.cwd,
  );
  const results: SingleResult[] = [];
  const partialResults: MutableSingleResult[] = [];
  let previousOutput = "";

  for (let index = 0; index < chain.length; index += 1) {
    const step = chain[index];
    const config = requireConfig(subagents, step.agent);
    const resolvedCwd = step.cwd ?? ctx.cwd;
    const taskTemplate = resolveChainTaskTemplate(step.task ?? undefined, index === 0);
    const expandedTask = expandChainTaskTemplate(taskTemplate, {
      originalTask,
      previousOutput,
      chainDir,
    });
    const readPaths = resolveChainReadPaths(chainDir, step.reads);
    await assertChainReadPathsExist(readPaths);
    const task = buildChainTask(expandedTask, readPaths);
    const skillNames = resolveSelectedSkillNames(config.skills, step.skillSelection);
    const skillPaths = await resolveSkillPaths(resolvedCwd, skillNames);
    const sessionHandle = persist ? await createSubagentSessionHandle() : null;
    partialResults[index] = createMutableResult(
      config,
      task,
      index + 1,
      resolveSubagentModel(config, sessionModel, step.model),
      sessionHandle,
    );

    const result = await runSingleSubagent(
      config,
      task,
      resolvedCwd,
      index + 1,
      sessionModel,
      step.model,
      skillPaths,
      sessionHandle,
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
      const truncatedOutput = await truncateAndPersistOutput(
        `${buildFinalOutputText("chain", results, outputMode)}\n\nchainDir: ${chainDir}`,
      );

      return {
        content: [{ type: "text", text: truncatedOutput.text }],
        details: {
          mode: "chain",
          results,
          outputMode,
          chainDir,
          truncated: truncatedOutput.truncated,
          fullOutputPath: truncatedOutput.fullOutputPath,
        },
      };
    }

    previousOutput = result.finalOutput.trim().length > 0 ? result.finalOutput : "";
    const outputPath = resolveChainOutputPath(chainDir, step.output);
    if (outputPath !== null) {
      await writeChainOutput(outputPath, previousOutput);
    }
  }

  const truncatedOutput = await truncateAndPersistOutput(
    `${buildFinalOutputText("chain", results, outputMode)}\n\nchainDir: ${chainDir}`,
  );

  return {
    content: [{ type: "text", text: truncatedOutput.text }],
    details: {
      mode: "chain",
      results,
      outputMode,
      chainDir,
      truncated: truncatedOutput.truncated,
      fullOutputPath: truncatedOutput.fullOutputPath,
    },
  };
};

export default function subagentsExtension(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    const subagents = await loadSubagents(process.cwd());
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
      "Consult one or more named subagents from ~/.pi/agent/agents or the nearest .pi/agents directory. Each subagent runs in an isolated pi child process with its configured tool permissions. Supports single mode, parallel mode, sequential chain mode with {task}/{previous}/{chain_dir}, optional skill and model overrides, and optional async background execution.",
    promptSnippet:
      "Consult named subagents for isolated analysis or implementation, optionally in parallel or as a chain.",
    promptGuidelines: [
      "Use this tool when a task would benefit from a deeper isolated pass before you act.",
      "Choose subagents by name from the available subagents listed in the system prompt.",
      "Subagents without explicit permissions default to a read-mostly research profile.",
      "Use single mode by default. Use tasks for independent investigations that can run in parallel.",
      "Use chain when later steps should build on earlier subagent output via {previous}, the original request via {task}, or shared artifacts via {chain_dir}.",
      "Use model and skill overrides when one step needs a different model or a specific skill set.",
      "Set async: true to run in the background and inspect progress later with subagent_status.",
      "Set persist: true to keep isolated child state, then reuse the returned sessionId in a later single-mode call to resume it.",
      "Use outputMode: \"collapsed\" or \"summary\" to keep delegated output compact in the parent context.",
      "Include concrete context in each task: goal, relevant files, suspected issue, constraints, and desired outcome.",
      "Treat subagent output as advisory and decide what to do next yourself.",
    ],
    parameters: WebfetchAwareSubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (params.async === true) {
        const hasSingle = hasSingleMode(params);
        const hasParallel = hasParallelMode(params);
        const hasChain = hasChainMode(params);
        const modeCount = Number(hasSingle) + Number(hasParallel) + Number(hasChain);
        if (modeCount !== 1) {
          throw new Error(
            "Provide exactly one subagent mode: single (agent + task), parallel (tasks), or chain (chain).",
          );
        }

        const availableSubagents = await loadSubagents(ctx.cwd);
        if (availableSubagents.length === 0) {
          throw new Error(
            "No subagents found in ~/.pi/agent/agents or the nearest .pi/agents.",
          );
        }

        const activeModel = ctx.model;
        if (activeModel === undefined) {
          throw new Error("No active model is selected for consult_subagent.");
        }

        const launchedRun = await launchAsyncSubagent(params, {
          cwd: ctx.cwd,
          model: activeModel,
        });

        return {
          content: [
            {
              type: "text",
              text:
                `Subagent run started in background.\n\n` +
                `runId: ${launchedRun.runId}\n` +
                `statusDir: ${launchedRun.asyncDir}\n\n` +
                `Use subagent_status with the runId to inspect progress.`,
            },
          ],
          details: {
            async: true,
            runId: launchedRun.runId,
            asyncDir: launchedRun.asyncDir,
          },
        };
      }

      return await executeConsultSubagentSync(params, signal, onUpdate, {
        cwd: ctx.cwd,
        model: ctx.model,
      });
    },

    renderCall(args, theme) {
      const callArgs: JsonRecord = isRecord(args) ? args : {};
      const chain = Array.isArray(callArgs.chain) ? callArgs.chain : [];
      const asyncLabel = callArgs.async === true ? ` ${theme.fg("warning", "[async]")}` : "";

      if (chain.length > 0) {
        let text =
          theme.fg("toolTitle", theme.bold("consult_subagent ")) +
          theme.fg("accent", `chain (${chain.length} steps)`) +
          asyncLabel;
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
          theme.fg("accent", `parallel (${tasks.length} tasks)`) +
          asyncLabel;
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
        `${theme.fg("toolTitle", theme.bold("consult_subagent "))}${theme.fg("accent", agent)}${asyncLabel}\n  ${theme.fg("dim", preview)}`,
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

        if (subagentResult.sessionId !== null) {
          const sessionLabel =
            subagentResult.sessionFile === null
              ? `session: ${subagentResult.sessionId}`
              : `session: ${subagentResult.sessionId} · ${shortenHomePath(subagentResult.sessionFile)}`;
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("dim", sessionLabel), 0, 0));
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

  pi.registerTool({
    name: SUBAGENT_STATUS_TOOL,
    label: "Subagent Status",
    description: "Inspect the status of a background consult_subagent run by id or async directory.",
    parameters: SubagentStatusParams,

    async execute(_toolCallId, params) {
      const asyncDir = isNonEmptyString(params.dir)
        ? params.dir.trim()
        : isNonEmptyString(params.id)
          ? await findAsyncDir(params.id)
          : null;

      if (asyncDir === null) {
        throw new Error("Provide a background run id or async directory.");
      }

      const status = await readAsyncStatus(asyncDir);
      if (status === null) {
        throw new Error(
          `Could not read background subagent status from ${asyncDir}. The run may not exist anymore.`,
        );
      }

      const result = await readAsyncResult(asyncDir);
      const lines = [
        `runId: ${status.runId}`,
        `state: ${status.state}`,
        `mode: ${status.mode}`,
        `progress: ${status.completedItems}/${status.totalItems}`,
        `updatedAt: ${status.updatedAt}`,
      ];

      if (status.chainDir !== null) {
        lines.push(`chainDir: ${status.chainDir}`);
      }

      if (status.errorMessage !== null) {
        lines.push(`error: ${status.errorMessage}`);
      }

      const resultText = extractResultText(result);
      if (resultText !== null) {
        lines.push("", resultText);
      } else if (status.latestSummary !== null) {
        lines.push("", status.latestSummary);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          asyncDir,
          status,
          result,
        },
      };
    },

    renderCall(args, theme) {
      const callArgs: JsonRecord = isRecord(args) ? args : {};
      const label = isNonEmptyString(callArgs.id)
        ? callArgs.id.trim()
        : isNonEmptyString(callArgs.dir)
          ? callArgs.dir.trim()
          : "...";
      return new Text(
        `${theme.fg("toolTitle", theme.bold("subagent_status "))}${theme.fg("accent", label)}`,
        0,
        0,
      );
    },

    renderResult(result) {
      const firstContent = result.content[0];
      const text = firstContent?.type === "text" ? firstContent.text : EMPTY_OUTPUT_MESSAGE;
      return new Text(text, 0, 0);
    },
  });
}
