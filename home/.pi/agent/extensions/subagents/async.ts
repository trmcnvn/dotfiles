import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ASYNC_RUNNER_PATH = fileURLToPath(new URL("./async-runner.ts", import.meta.url));
const SUBAGENT_ASYNC_ROOT = join(
  homedir(),
  ".pi",
  "agent",
  "internal",
  "subagents",
  "async",
);
const STATUS_FILE = "status.json";
const EVENTS_FILE = "events.jsonl";
const RESULT_FILE = "result.json";
const CONFIG_FILE = "config.json";

export type AsyncRunMode = "single" | "parallel" | "chain";
export type AsyncRunState = "queued" | "running" | "completed" | "failed";

export type AsyncStatus = {
  readonly version: 1;
  readonly runId: string;
  readonly mode: AsyncRunMode;
  readonly state: AsyncRunState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedItems: number;
  readonly totalItems: number;
  readonly latestSummary: string | null;
  readonly errorMessage: string | null;
  readonly chainDir: string | null;
  readonly resultPath: string | null;
};

export type AsyncLaunchContext = {
  readonly cwd: string;
  readonly model: {
    readonly provider: string;
    readonly id: string;
  };
};

export type AsyncRunnerConfig = {
  readonly runId: string;
  readonly params: Record<string, unknown>;
  readonly cwd: string;
  readonly model: {
    readonly provider: string;
    readonly id: string;
  };
  readonly asyncDir: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const parseAsyncRunMode = (value: unknown): AsyncRunMode | null =>
  value === "single" || value === "parallel" || value === "chain" ? value : null;

const detectMode = (params: Record<string, unknown>): AsyncRunMode => {
  if (Array.isArray(params.tasks) && params.tasks.length > 0) {
    return "parallel";
  }

  if (Array.isArray(params.chain) && params.chain.length > 0) {
    return "chain";
  }

  return "single";
};

const computeTotalItems = (
  mode: AsyncRunMode,
  params: Record<string, unknown>,
): number => {
  if (mode === "parallel") {
    return Array.isArray(params.tasks) ? params.tasks.length : 0;
  }

  if (mode === "chain") {
    return Array.isArray(params.chain) ? params.chain.length : 0;
  }

  return 1;
};

const getBunPath = (): string => {
  const bunBinaryPath = execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
  if (bunBinaryPath.length === 0) {
    throw new Error(
      "Could not locate bun on PATH. Background subagent runs require bun to execute the async runner.",
    );
  }

  return bunBinaryPath;
};

const getNodeModulesRoot = (): string => {
  const piBinaryPath = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
  if (piBinaryPath.length === 0) {
    throw new Error("Could not locate pi on PATH.");
  }

  const resolvedPiBinaryPath = realpathSync(piBinaryPath);
  return dirname(dirname(dirname(dirname(resolvedPiBinaryPath))));
};

export const getAsyncRoot = (): string => SUBAGENT_ASYNC_ROOT;
export const getAsyncDir = (runId: string): string => join(SUBAGENT_ASYNC_ROOT, runId);
export const getStatusFilePath = (asyncDir: string): string => join(asyncDir, STATUS_FILE);
export const getEventsFilePath = (asyncDir: string): string => join(asyncDir, EVENTS_FILE);
export const getResultFilePath = (asyncDir: string): string => join(asyncDir, RESULT_FILE);
export const getConfigFilePath = (asyncDir: string): string => join(asyncDir, CONFIG_FILE);

export const ensureAsyncRoot = async (): Promise<void> => {
  await mkdir(SUBAGENT_ASYNC_ROOT, { recursive: true });
};

export const createInitialAsyncStatus = (
  runId: string,
  mode: AsyncRunMode,
  totalItems: number,
): AsyncStatus => {
  const now = new Date().toISOString();
  return {
    version: 1,
    runId,
    mode,
    state: "queued",
    createdAt: now,
    updatedAt: now,
    completedItems: 0,
    totalItems,
    latestSummary: null,
    errorMessage: null,
    chainDir: null,
    resultPath: null,
  };
};

export const writeAsyncStatus = async (
  asyncDir: string,
  status: AsyncStatus,
): Promise<void> => {
  await mkdir(asyncDir, { recursive: true });
  await writeFile(getStatusFilePath(asyncDir), `${JSON.stringify(status, null, 2)}\n`, "utf8");
};

export const appendAsyncEvent = async (
  asyncDir: string,
  event: Record<string, unknown>,
): Promise<void> => {
  await mkdir(asyncDir, { recursive: true });
  await appendFile(getEventsFilePath(asyncDir), `${JSON.stringify(event)}\n`, "utf8");
};

export const writeAsyncResult = async (
  asyncDir: string,
  result: unknown,
): Promise<string> => {
  const resultPath = getResultFilePath(asyncDir);
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return resultPath;
};

const parseAsyncStatus = (value: unknown): AsyncStatus | null => {
  if (!isRecord(value)) {
    return null;
  }

  const mode = parseAsyncRunMode(value.mode);
  if (
    value.version !== 1 ||
    mode === null ||
    !isNonEmptyString(value.runId) ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.updatedAt) ||
    typeof value.completedItems !== "number" ||
    typeof value.totalItems !== "number"
  ) {
    return null;
  }

  if (
    value.state !== "queued" &&
    value.state !== "running" &&
    value.state !== "completed" &&
    value.state !== "failed"
  ) {
    return null;
  }

  return {
    version: 1,
    runId: value.runId,
    mode,
    state: value.state,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedItems: value.completedItems,
    totalItems: value.totalItems,
    latestSummary: isNonEmptyString(value.latestSummary) ? value.latestSummary : null,
    errorMessage: isNonEmptyString(value.errorMessage) ? value.errorMessage : null,
    chainDir: isNonEmptyString(value.chainDir) ? value.chainDir : null,
    resultPath: isNonEmptyString(value.resultPath) ? value.resultPath : null,
  };
};

export const readAsyncStatus = async (
  asyncDir: string,
): Promise<AsyncStatus | null> => {
  try {
    const rawStatus = await readFile(getStatusFilePath(asyncDir), "utf8");
    return parseAsyncStatus(JSON.parse(rawStatus));
  } catch {
    return null;
  }
};

export const readAsyncResult = async (asyncDir: string): Promise<unknown | null> => {
  try {
    const rawResult = await readFile(getResultFilePath(asyncDir), "utf8");
    return JSON.parse(rawResult);
  } catch {
    return null;
  }
};

export const findAsyncDir = async (rawId: string): Promise<string | null> => {
  await ensureAsyncRoot();
  const trimmedId = rawId.trim();
  if (trimmedId.length === 0) {
    return null;
  }

  const directPath = getAsyncDir(trimmedId);
  const directStatus = await readAsyncStatus(directPath);
  if (directStatus !== null) {
    return directPath;
  }

  let entries: readonly string[];
  try {
    entries = await readdir(SUBAGENT_ASYNC_ROOT);
  } catch {
    return null;
  }

  const matches = entries
    .filter((entry) => entry.startsWith(trimmedId))
    .sort((left, right) => left.localeCompare(right));
  const match = matches[0];
  return match === undefined ? null : getAsyncDir(match);
};

export const launchAsyncSubagent = async (
  params: Record<string, unknown>,
  ctx: AsyncLaunchContext,
): Promise<{
  readonly runId: string;
  readonly asyncDir: string;
  readonly status: AsyncStatus;
}> => {
  await ensureAsyncRoot();

  const runId = randomUUID();
  const asyncDir = getAsyncDir(runId);
  await mkdir(asyncDir, { recursive: true });

  const mode = detectMode(params);
  const status = createInitialAsyncStatus(runId, mode, computeTotalItems(mode, params));
  await writeAsyncStatus(asyncDir, status);
  await appendAsyncEvent(asyncDir, {
    type: "queued",
    timestamp: new Date().toISOString(),
    mode,
  });

  const config: AsyncRunnerConfig = {
    runId,
    params: { ...params, async: false },
    cwd: ctx.cwd,
    model: ctx.model,
    asyncDir,
  };
  await writeFile(getConfigFilePath(asyncDir), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const child = spawn(getBunPath(), [ASYNC_RUNNER_PATH, getConfigFilePath(asyncDir)], {
    cwd: ctx.cwd,
    env: {
      ...process.env,
      NODE_PATH: getNodeModulesRoot(),
    },
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return {
    runId,
    asyncDir,
    status,
  };
};
