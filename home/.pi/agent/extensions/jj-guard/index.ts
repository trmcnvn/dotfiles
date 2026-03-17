import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { isToolCallEventType, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

const GIT_COMMAND_PATTERN = /(^|[;&|()\s])git(?=\s|$)/i;

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

export default function jjGuardExtension(pi: ExtensionAPI) {
  pi.on("tool_call", (event, ctx) => {
    if (!isToolCallEventType("bash", event)) {
      return undefined;
    }

    const command = event.input.command;
    if (!GIT_COMMAND_PATTERN.test(command)) {
      return undefined;
    }

    if (findJjRepoRoot(ctx.cwd) === null) {
      return undefined;
    }

    return {
      block: true,
      reason:
        "This directory is inside a Jujutsu repo. Use `jj` commands instead of `git`.",
    };
  });
}
