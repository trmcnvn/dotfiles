import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  isFindToolResult,
  isGrepToolResult,
  isLsToolResult,
  isReadToolResult,
  type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";

const LS_DEFAULT_LIMIT = 500;
const FIND_DEFAULT_LIMIT = 1000;
const GREP_DEFAULT_LIMIT = 100;

type JsonRecord = Record<string, unknown>;

type ExecResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  readonly killed: boolean;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const parsePositiveInteger = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const parsed = Math.trunc(value);
  return parsed > 0 ? parsed : null;
};

const parseNonNegativeInteger = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const parsed = Math.trunc(value);
  return parsed >= 0 ? parsed : null;
};

const normalizePathInput = (value: string): string =>
  value.startsWith("@") ? value.slice(1) : value;

const hasTruncation = (details: unknown): boolean => {
  if (!isRecord(details)) {
    return false;
  }

  const truncation = details.truncation;
  return isRecord(truncation) && truncation.truncated === true;
};

const hasFullOutputPath = (details: unknown): boolean =>
  isRecord(details) && isNonEmptyString(details.fullOutputPath);

const appendNoticeToContent = (
  content: readonly (TextContent | ImageContent)[],
  notice: string,
): (TextContent | ImageContent)[] | null => {
  const firstTextIndex = content.findIndex((part) => part.type === "text");
  if (firstTextIndex < 0) {
    return null;
  }

  const firstTextPart = content[firstTextIndex];
  if (firstTextPart.type !== "text") {
    return null;
  }

  if (firstTextPart.text.includes(notice)) {
    return [...content];
  }

  const nextContent = [...content];
  nextContent[firstTextIndex] = {
    ...firstTextPart,
    text: `${firstTextPart.text}\n\n[${notice}]`,
  };

  return nextContent;
};

const mergeDetailsWithPath = (
  details: unknown,
  fullOutputPath: string,
): Record<string, unknown> => {
  const base = isRecord(details) ? details : {};
  return {
    ...base,
    fullOutputPath,
  };
};

const persistOverflowOutput = async (
  toolName: string,
  output: string,
): Promise<string> => {
  const tempDir = await mkdtemp(join(tmpdir(), `pi-${toolName}-`));
  const outputPath = join(tempDir, "output.txt");
  await writeFile(outputPath, output, "utf8");
  return outputPath;
};

const buildReadOutput = async (
  input: JsonRecord,
  cwd: string,
): Promise<string | null> => {
  const rawPath = input.path;
  if (!isNonEmptyString(rawPath)) {
    return null;
  }

  const path = normalizePathInput(rawPath.trim());
  const absolutePath = resolve(cwd, path);

  const textContent = await readFile(absolutePath, "utf8");
  const allLines = textContent.split("\n");

  const offset = parsePositiveInteger(input.offset);
  const limit = parsePositiveInteger(input.limit);
  const startLine = offset === null ? 0 : Math.max(0, offset - 1);

  if (startLine >= allLines.length) {
    return null;
  }

  if (limit === null) {
    return allLines.slice(startLine).join("\n");
  }

  return allLines.slice(startLine, startLine + limit).join("\n");
};

const buildLsOutput = async (
  input: JsonRecord,
  cwd: string,
): Promise<string | null> => {
  const rawPath = isNonEmptyString(input.path) ? input.path.trim() : ".";
  const absolutePath = resolve(cwd, normalizePathInput(rawPath));
  const effectiveLimit = parsePositiveInteger(input.limit) ?? LS_DEFAULT_LIMIT;

  const pathStats = await stat(absolutePath);
  if (!pathStats.isDirectory()) {
    return null;
  }

  const entries = await readdir(absolutePath);
  entries.sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));

  const formattedEntries: string[] = [];
  for (const entry of entries) {
    if (formattedEntries.length >= effectiveLimit) {
      break;
    }

    const entryPath = resolve(absolutePath, entry);
    let entryStats;
    try {
      entryStats = await stat(entryPath);
    } catch {
      continue;
    }

    formattedEntries.push(entryStats.isDirectory() ? `${entry}/` : entry);
  }

  if (formattedEntries.length === 0) {
    return "(empty directory)";
  }

  return formattedEntries.join("\n");
};

const buildFindOutput = async (
  pi: ExtensionAPI,
  input: JsonRecord,
  cwd: string,
): Promise<string | null> => {
  const pattern = input.pattern;
  if (!isNonEmptyString(pattern)) {
    return null;
  }

  const rawSearchPath = isNonEmptyString(input.path) ? input.path.trim() : ".";
  const searchPath = resolve(cwd, normalizePathInput(rawSearchPath));
  const effectiveLimit = parsePositiveInteger(input.limit) ?? FIND_DEFAULT_LIMIT;

  const result = (await pi.exec(
    "fd",
    [
      "--glob",
      "--color=never",
      "--hidden",
      "--max-results",
      String(effectiveLimit),
      pattern,
      searchPath,
    ],
    { timeout: 20_000 },
  )) as ExecResult;

  if (result.code !== 0 && result.stdout.trim().length === 0) {
    return null;
  }

  const lines = result.stdout.split("\n");
  const relativized: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (line.length === 0) {
      continue;
    }

    const hadTrailingSlash = line.endsWith("/") || line.endsWith("\\");
    let relativePath = line.startsWith(searchPath)
      ? line.slice(searchPath.length + 1)
      : relative(searchPath, line);

    if (hadTrailingSlash && !relativePath.endsWith("/")) {
      relativePath += "/";
    }

    relativized.push(relativePath);
  }

  return relativized.join("\n");
};

const buildGrepOutput = async (
  pi: ExtensionAPI,
  input: JsonRecord,
  cwd: string,
): Promise<string | null> => {
  const pattern = input.pattern;
  if (!isNonEmptyString(pattern)) {
    return null;
  }

  const rawSearchPath = isNonEmptyString(input.path) ? input.path.trim() : ".";
  const searchPath = resolve(cwd, normalizePathInput(rawSearchPath));

  const args: string[] = ["--line-number", "--color=never", "--hidden"];

  if (input.ignoreCase === true) {
    args.push("--ignore-case");
  }

  if (input.literal === true) {
    args.push("--fixed-strings");
  }

  if (isNonEmptyString(input.glob)) {
    args.push("--glob", input.glob.trim());
  }

  const context = parseNonNegativeInteger(input.context);
  if (context !== null && context > 0) {
    args.push("--context", String(context));
  }

  const limit = parsePositiveInteger(input.limit) ?? GREP_DEFAULT_LIMIT;
  args.push("--max-count", String(limit));

  args.push(pattern, searchPath);

  const result = (await pi.exec("rg", args, { timeout: 20_000 })) as ExecResult;

  if (result.code !== 0 && result.code !== 1 && result.stdout.trim().length === 0) {
    return null;
  }

  const output = result.stdout.trim();
  return output.length > 0 ? output : null;
};

export const registerTruncatedBuiltinsOverflowHandler = (
  pi: ExtensionAPI,
): void => {
  pi.on("tool_result", async (event, ctx) => {
    if (hasFullOutputPath(event.details)) {
      return undefined;
    }

    try {
      let toolName: "read" | "ls" | "find" | "grep" | null = null;
      let fullOutput: string | null = null;

      if (isReadToolResult(event)) {
        if (!hasTruncation(event.details)) {
          return undefined;
        }

        toolName = "read";
        fullOutput = await buildReadOutput(event.input, ctx.cwd);
      } else if (isLsToolResult(event)) {
        if (!hasTruncation(event.details)) {
          return undefined;
        }

        toolName = "ls";
        fullOutput = await buildLsOutput(event.input, ctx.cwd);
      } else if (isFindToolResult(event)) {
        if (!hasTruncation(event.details)) {
          return undefined;
        }

        toolName = "find";
        fullOutput = await buildFindOutput(pi, event.input, ctx.cwd);
      } else if (isGrepToolResult(event)) {
        if (!hasTruncation(event.details)) {
          return undefined;
        }

        toolName = "grep";
        fullOutput = await buildGrepOutput(pi, event.input, ctx.cwd);
      } else {
        return undefined;
      }

      if (toolName === null || fullOutput === null || fullOutput.length === 0) {
        return undefined;
      }

      const outputPath = await persistOverflowOutput(toolName, fullOutput);
      const notice = `Output overflowed ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. Full output saved to: ${outputPath}`;

      const updatedContent = appendNoticeToContent(event.content, notice);
      const updatedDetails = mergeDetailsWithPath(event.details, outputPath);

      if (updatedContent === null) {
        return { details: updatedDetails };
      }

      return {
        content: updatedContent,
        details: updatedDetails,
      };
    } catch {
      return undefined;
    }
  });
};

export default function truncatedBuiltins(pi: ExtensionAPI) {
  registerTruncatedBuiltinsOverflowHandler(pi);
}
