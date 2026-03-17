import { readFile } from "node:fs/promises";
import { executeConsultSubagentSync } from "./index.js";
import {
  appendAsyncEvent,
  getResultFilePath,
  readAsyncStatus,
  type AsyncRunnerConfig,
  type AsyncStatus,
  writeAsyncResult,
  writeAsyncStatus,
} from "./async.js";

type JsonRecord = Record<string, unknown>;

type ToolUpdate = {
  readonly content?: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
  }>;
  readonly details?: unknown;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const parseConfig = (value: unknown): AsyncRunnerConfig => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.runId) ||
    !isRecord(value.params) ||
    !isNonEmptyString(value.cwd) ||
    !isRecord(value.model) ||
    !isNonEmptyString(value.model.provider) ||
    !isNonEmptyString(value.model.id) ||
    !isNonEmptyString(value.asyncDir)
  ) {
    throw new Error("Invalid async subagent runner config.");
  }

  return {
    runId: value.runId,
    params: value.params,
    cwd: value.cwd,
    model: {
      provider: value.model.provider,
      id: value.model.id,
    },
    asyncDir: value.asyncDir,
  };
};

const extractLatestSummary = (update: ToolUpdate): string | null => {
  if (!Array.isArray(update.content)) {
    return null;
  }

  const firstText = update.content.find(
    (item): item is { readonly type: string; readonly text: string } =>
      item.type === "text" && typeof item.text === "string",
  );

  return firstText?.text ?? null;
};

const countCompletedItems = (details: unknown): number | null => {
  if (!isRecord(details) || !Array.isArray(details.results)) {
    return null;
  }

  let completedItems = 0;
  for (const result of details.results) {
    if (!isRecord(result) || typeof result.exitCode !== "number") {
      continue;
    }
    if (result.exitCode >= 0) {
      completedItems += 1;
    }
  }

  return completedItems;
};

const readChainDir = (details: unknown): string | null => {
  if (!isRecord(details)) {
    return null;
  }

  return isNonEmptyString(details.chainDir) ? details.chainDir : null;
};

const main = async (): Promise<void> => {
  const configPath = process.argv[2];
  if (typeof configPath !== "string" || configPath.length === 0) {
    throw new Error("Missing async subagent runner config path.");
  }

  const rawConfig = await readFile(configPath, "utf8");
  const config = parseConfig(JSON.parse(rawConfig));
  const initialStatus = await readAsyncStatus(config.asyncDir);
  if (initialStatus === null) {
    throw new Error(`Async status file is missing for run ${config.runId}.`);
  }

  let status: AsyncStatus = {
    ...initialStatus,
    state: "running",
    updatedAt: new Date().toISOString(),
  };
  await writeAsyncStatus(config.asyncDir, status);
  await appendAsyncEvent(config.asyncDir, {
    type: "started",
    timestamp: new Date().toISOString(),
  });

  let pendingWrite = Promise.resolve();
  const handleUpdate = (update: ToolUpdate): void => {
    pendingWrite = pendingWrite.then(async () => {
      const latestSummary = extractLatestSummary(update);
      const completedItems = countCompletedItems(update.details);
      const chainDir = readChainDir(update.details) ?? status.chainDir;
      status = {
        ...status,
        latestSummary: latestSummary ?? status.latestSummary,
        completedItems: completedItems ?? status.completedItems,
        chainDir,
        updatedAt: new Date().toISOString(),
      };
      await writeAsyncStatus(config.asyncDir, status);
      await appendAsyncEvent(config.asyncDir, {
        type: "update",
        timestamp: new Date().toISOString(),
        completedItems: status.completedItems,
        totalItems: status.totalItems,
        latestSummary: status.latestSummary,
      });
    });
  };

  try {
    const result = await executeConsultSubagentSync(
      config.params,
      undefined,
      (update) => {
        handleUpdate(update as ToolUpdate);
      },
      {
        cwd: config.cwd,
        model: config.model,
      },
    );

    await pendingWrite;

    const resultPath = await writeAsyncResult(config.asyncDir, result);
    status = {
      ...status,
      state: "completed",
      latestSummary: extractLatestSummary(result) ?? status.latestSummary,
      completedItems: status.totalItems,
      chainDir: readChainDir(result.details) ?? status.chainDir,
      resultPath,
      updatedAt: new Date().toISOString(),
    };
    await writeAsyncStatus(config.asyncDir, status);
    await appendAsyncEvent(config.asyncDir, {
      type: "completed",
      timestamp: new Date().toISOString(),
      resultPath: getResultFilePath(config.asyncDir),
    });
  } catch (error) {
    await pendingWrite;

    const errorMessage = error instanceof Error ? error.message : String(error);
    status = {
      ...status,
      state: "failed",
      errorMessage,
      updatedAt: new Date().toISOString(),
    };
    await writeAsyncStatus(config.asyncDir, status);
    await appendAsyncEvent(config.asyncDir, {
      type: "failed",
      timestamp: new Date().toISOString(),
      errorMessage,
    });
    process.exitCode = 1;
  }
};

await main();
