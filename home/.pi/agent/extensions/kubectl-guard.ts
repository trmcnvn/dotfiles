/**
 * Kubectl Guard
 *
 * Any bash command that references kubectl is blocked. This intentionally
 * fails closed instead of trying to distinguish direct invocations from
 * wrappers, nested shells, or generated scripts.
 */

import {
  isToolCallEventType,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const KUBECTL_PATTERN = /(^|[^a-z0-9_-])kubectl(?=$|[^a-z0-9_-])/i;

const KUBECTL_BLOCK_REASON =
  "BLOCKED: kubectl commands are forbidden in this environment.";

export const commandReferencesKubectl = (command: string): boolean =>
  KUBECTL_PATTERN.test(command);

export default function kubectlGuardExtension(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return undefined;
    if (!commandReferencesKubectl(event.input.command)) return undefined;

    return { block: true, reason: KUBECTL_BLOCK_REASON };
  });

  pi.on("user_bash", (event) => {
    if (!commandReferencesKubectl(event.command)) return undefined;

    return {
      result: {
        output: KUBECTL_BLOCK_REASON,
        exitCode: 1,
        cancelled: false,
        truncated: false,
      },
    };
  });
}
