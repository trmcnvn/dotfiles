/**
 * Git/JJ Guard
 *
 * Any bash command that invokes git is blocked and redirected to jj.
 */

import {
  isToolCallEventType,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const GIT_COMMAND_PATTERN =
  /(^|[;&|()\n])\s*(?:(?:sudo|command)\s+|env\s+(?:\S+=\S+\s+)*)?git(?=\s|$)/i;
const QUOTED_TEXT_PATTERN = /'[^']*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const HEREDOC_REDIRECT_PATTERN = /<<-?\s*(?:'([^']+)'|"([^"]+)"|([^\s;&|()]+))/g;

const GIT_BLOCK_REASON =
  "BLOCKED: Use `jj` commands instead of `git`. Do not run git commands in this environment.";

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

export default function jjGuardExtension(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return undefined;
    if (!commandInvokesGit(event.input.command)) return undefined;

    return { block: true, reason: GIT_BLOCK_REASON };
  });

  pi.on("user_bash", (event) => {
    if (!commandInvokesGit(event.command)) return undefined;

    return {
      result: {
        output: GIT_BLOCK_REASON,
        exitCode: 1,
        cancelled: false,
        truncated: false,
      },
    };
  });
}
