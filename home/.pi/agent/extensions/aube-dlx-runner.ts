/**
 * Aube DLX Runner
 *
 * Rewrites package runner invocations in Pi bash commands so `npx`, `bunx`,
 * and `pnpx` execute through `aube dlx` instead.
 */

import {
  createLocalBashOperations,
  isToolCallEventType,
  type BashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const PACKAGE_RUNNER_COMMAND_PATTERN =
  /(^|[;&|()\n])(\s*)((?:(?:sudo|command)\s+|env\s+(?:\S+=\S+\s+)*)?)(npx|bunx|pnpx)(?=\s|$)/gi;

const rewritePackageRunnerCommands = (command: string): string =>
  command.replace(PACKAGE_RUNNER_COMMAND_PATTERN, (_match, separator, spacing, prefix) => {
    return `${separator}${spacing}${prefix}aube dlx`;
  });

const createRewritingBashOperations = (): BashOperations => {
  const localOperations = createLocalBashOperations();

  return {
    exec: (command, cwd, options) => {
      return localOperations.exec(rewritePackageRunnerCommands(command), cwd, options);
    },
  };
};

export default function aubeDlxRunnerExtension(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return undefined;

    const rewrittenCommand = rewritePackageRunnerCommands(event.input.command);
    if (rewrittenCommand === event.input.command) return undefined;

    event.input.command = rewrittenCommand;
    return undefined;
  });

  pi.on("user_bash", (event) => {
    const rewrittenCommand = rewritePackageRunnerCommands(event.command);
    if (rewrittenCommand === event.command) return undefined;

    return { operations: createRewritingBashOperations() };
  });
}
