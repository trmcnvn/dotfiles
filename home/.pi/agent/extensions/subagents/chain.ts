import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const CHAIN_DIR_PREFIX = "pi-subagent-chain-";

export type ChainVariableContext = {
  readonly originalTask: string;
  readonly previousOutput: string;
  readonly chainDir: string;
};

export const createChainDir = async (
  rawChainDir: string | undefined,
  cwd: string,
): Promise<string> => {
  if (rawChainDir !== undefined) {
    const resolvedChainDir = isAbsolute(rawChainDir)
      ? rawChainDir
      : resolve(cwd, rawChainDir);
    await mkdir(resolvedChainDir, { recursive: true });
    return resolvedChainDir;
  }

  return await mkdtemp(join(tmpdir(), CHAIN_DIR_PREFIX));
};

export const resolveChainTaskTemplate = (
  rawTask: string | undefined,
  isFirstStep: boolean,
): string => {
  if (typeof rawTask === "string" && rawTask.trim().length > 0) {
    return rawTask;
  }

  return isFirstStep ? "{task}" : "{previous}";
};

export const expandChainTaskTemplate = (
  template: string,
  context: ChainVariableContext,
): string =>
  template
    .replace(/\{task\}/g, context.originalTask)
    .replace(/\{previous\}/g, context.previousOutput)
    .replace(/\{chain_dir\}/g, context.chainDir);

const resolveChainPath = (chainDir: string, rawPath: string): string =>
  isAbsolute(rawPath) ? rawPath : resolve(chainDir, rawPath);

export const resolveChainReadPaths = (
  chainDir: string,
  reads: readonly string[],
): readonly string[] => reads.map((readPath) => resolveChainPath(chainDir, readPath));

export const resolveChainOutputPath = (
  chainDir: string,
  output: string | undefined,
): string | null => {
  if (output === undefined || output.trim().length === 0) {
    return null;
  }

  return resolveChainPath(chainDir, output);
};

export const assertChainReadPathsExist = async (
  readPaths: readonly string[],
): Promise<void> => {
  for (const readPath of readPaths) {
    try {
      await access(readPath);
    } catch {
      throw new Error(
        `Chain read path ${readPath} does not exist yet. Ensure an earlier step writes it before a later step reads it.`,
      );
    }
  }
};

export const buildChainTask = (
  expandedTask: string,
  readPaths: readonly string[],
): string => {
  if (readPaths.length === 0) {
    return expandedTask;
  }

  const readInstructions = [
    "Before answering, read these files for context:",
    ...readPaths.map((readPath) => `- ${readPath}`),
    "",
  ].join("\n");

  return `${readInstructions}${expandedTask}`;
};

export const writeChainOutput = async (
  outputPath: string,
  output: string,
): Promise<void> => {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    output.endsWith("\n") ? output : `${output}\n`,
    "utf8",
  );
};

