import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { isToolCallEventType, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

const GIT_COMMAND_PATTERN =
  /(^|[;&|()\n])\s*(?:(?:sudo|command)\s+|env\s+(?:\S+=\S+\s+)*)?git(?=\s|$)/i;
const QUOTED_TEXT_PATTERN = /'[^']*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const HEREDOC_REDIRECT_PATTERN = /<<-?\s*(?:'([^']+)'|"([^"]+)"|([^\s;&|()]+))/g;

const findJjRepoRoot = (cwd: string): string | null => {
  let current = cwd;

  for (;;) {
    if (existsSync(join(current, ".jj"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
};

const getHereDocDelimiters = (line: string): readonly string[] => {
  const delimiters: string[] = [];
  for (const match of line.matchAll(HEREDOC_REDIRECT_PATTERN)) {
    const delimiter = match[1] ?? match[2] ?? match[3];
    if (delimiter !== undefined && delimiter.length > 0) {
      delimiters.push(delimiter);
    }
  }
  return delimiters;
};

const stripHereDocBodies = (command: string): string => {
  const keptLines: string[] = [];
  const pendingDelimiters: string[] = [];

  for (const line of command.split("\n")) {
    const pendingDelimiter = pendingDelimiters[0];
    if (pendingDelimiter !== undefined) {
      if (line.trim() === pendingDelimiter) {
        pendingDelimiters.shift();
      }
      continue;
    }

    keptLines.push(line);
    pendingDelimiters.push(...getHereDocDelimiters(line));
  }

  return keptLines.join("\n");
};

const commandInvokesGit = (command: string): boolean =>
  GIT_COMMAND_PATTERN.test(
    stripHereDocBodies(command).replace(QUOTED_TEXT_PATTERN, ""),
  );

const jjGuardMessage =
  "This directory is inside a Jujutsu repo. Use `jj` commands instead of `git`.";

export default function jjGuardExtension(pi: ExtensionAPI) {
  pi.on("tool_call", (event, ctx) => {
    if (!isToolCallEventType("bash", event)) {
      return undefined;
    }

    if (!commandInvokesGit(event.input.command)) {
      return undefined;
    }

    if (findJjRepoRoot(ctx.cwd) === null) {
      return undefined;
    }

    return {
      block: true,
      reason: jjGuardMessage,
    };
  });

  pi.on("user_bash", (event, ctx) => {
    if (!commandInvokesGit(event.command)) {
      return undefined;
    }

    if (findJjRepoRoot(ctx.cwd) === null) {
      return undefined;
    }

    return {
      result: {
        output: jjGuardMessage,
        exitCode: 1,
        cancelled: false,
        truncated: false,
      },
    };
  });
}
