/**
 * Destructive Command Guard
 *
 * Checks agent and user shell commands with dcg before execution.
 * See https://github.com/Dicklesworthstone/destructive_command_guard.
 */

import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const DCG_BIN = process.env.DCG_BIN ?? "dcg";
const DCG_TIMEOUT_MS = 1_000;
const DEFAULT_BLOCK_REASON = "BLOCKED: dcg identified a destructive command.";

type DcgDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "error"; readonly message: string };

type CommandAuthorization =
  | { readonly kind: "allow" }
  | { readonly kind: "block"; readonly reason: string };

const getStringProperty = (value: unknown, property: string): string | undefined => {
  if (typeof value !== "object" || value === null) return undefined;

  const propertyValue = Reflect.get(value, property);
  return typeof propertyValue === "string" ? propertyValue : undefined;
};

const getDecisionPayload = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null) return value;

  const data = Reflect.get(value, "data");
  return typeof data === "object" && data !== null ? data : value;
};

const formatBlockReason = (stdout: string): string => {
  try {
    const payload = getDecisionPayload(JSON.parse(stdout));
    const reason = getStringProperty(payload, "reason") ?? DEFAULT_BLOCK_REASON;
    const ruleId = getStringProperty(payload, "rule_id");
    const remediation = getStringProperty(payload, "remediation");

    return [
      ruleId === undefined ? reason : `${reason} [${ruleId}]`,
      remediation,
    ]
      .filter((part): part is string => part !== undefined)
      .join("\n");
  } catch {
    return DEFAULT_BLOCK_REASON;
  }
};

const checkCommand = async (
  pi: ExtensionAPI,
  command: string,
  cwd: string,
): Promise<DcgDecision> => {
  try {
    const result = await pi.exec(DCG_BIN, ["--robot", "test", command], {
      cwd,
      timeout: DCG_TIMEOUT_MS,
    });

    if (result.code === 0) return { kind: "allow" };
    if (result.code === 1) {
      return { kind: "deny", reason: formatBlockReason(result.stdout) };
    }

    return {
      kind: "error",
      message: `dcg exited with code ${result.code}; the command was not checked`,
    };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "unknown error";
    return {
      kind: "error",
      message: `dcg failed (${detail}); the command was not checked`,
    };
  }
};

export default function dcgGuardExtension(pi: ExtensionAPI) {
  let failureReported = false;

  const reportFailure = (ctx: ExtensionContext, message: string): void => {
    if (failureReported) return;

    failureReported = true;
    ctx.ui.notify(message, "warning");
  };

  const authorizeCommand = async (
    ctx: ExtensionContext,
    command: string,
    cwd: string,
  ): Promise<CommandAuthorization> => {
    const decision = await checkCommand(pi, command, cwd);

    if (decision.kind === "allow") return { kind: "allow" };

    if (decision.kind === "error") {
      const reason = `${decision.message}. Install dcg or set DCG_BIN before retrying.`;
      reportFailure(ctx, reason);
      return { kind: "block", reason };
    }

    if (ctx.hasUI) {
      const confirmed = await ctx.ui.confirm(
        "Destructive command blocked",
        [
          decision.reason,
          "",
          "Command:",
          command,
          "",
          `Working directory: ${cwd}`,
          "",
          "Allow this exact command once?",
        ].join("\n"),
      );
      if (confirmed) return { kind: "allow" };
    }

    return { kind: "block", reason: decision.reason };
  };

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return undefined;
    if (event.input.command.trim().length === 0) return undefined;

    const authorization = await authorizeCommand(
      ctx,
      event.input.command,
      ctx.cwd,
    );
    if (authorization.kind === "block") {
      return { block: true, reason: authorization.reason };
    }

    return undefined;
  });

  pi.on("user_bash", async (event, ctx) => {
    if (event.command.trim().length === 0) return undefined;

    const authorization = await authorizeCommand(
      ctx,
      event.command,
      event.cwd,
    );
    if (authorization.kind === "block") {
      return {
        result: {
          output: authorization.reason,
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }

    return undefined;
  });
}
