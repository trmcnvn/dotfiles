import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import type { McpRegisteredTool, McpServerDefinition, OAuthUi } from "./types.js";

const MCP_COMMAND_OUTPUT_TYPE = "mcp-command-output";
const MCP_COMMAND_USAGE = "Usage: /mcp [status|tools [server]|reconnect <server>]";

const MCP_SUBCOMMANDS: readonly {
  readonly name: "status" | "tools" | "reconnect";
  readonly value: string;
  readonly description: string;
}[] = [
  {
    name: "status",
    value: "status",
    description: "Show configured MCP servers and runtime status",
  },
  {
    name: "tools",
    value: "tools ",
    description: "List discovered or cached MCP tools",
  },
  {
    name: "reconnect",
    value: "reconnect ",
    description: "Close and reconnect one MCP server",
  },
];

type McpCommandOutputLevel = "info" | "warning" | "error";

type McpCommandOutputDetails = {
  readonly level: McpCommandOutputLevel;
};

export type McpCommandConnectionStatus = "connected" | "connecting" | "idle" | "failure";
export type McpCommandToolSource = "none" | "cached" | "discovered";

export type McpCommandServerStatus = {
  readonly serverKey: string;
  readonly serverType: McpServerDefinition["type"];
  readonly configuredEnabled: boolean;
  readonly sessionEnabled: boolean;
  readonly transport: string | null;
  readonly cachedToolCount: number;
  readonly discoveredToolCount: number;
  readonly connectionStatus: McpCommandConnectionStatus;
  readonly authStatus: string;
  readonly lastFailureMessage: string | null;
};

export type McpCommandServerTools = {
  readonly serverKey: string;
  readonly source: McpCommandToolSource;
  readonly cachedToolCount: number;
  readonly discoveredToolCount: number;
  readonly tools: readonly McpRegisteredTool[];
};

export type McpCommandToolsResult =
  | {
      readonly status: "ok";
      readonly serverTools: readonly McpCommandServerTools[];
    }
  | {
      readonly status: "unknown_server";
      readonly serverKey: string;
    };

export type McpCommandReconnectResult =
  | {
      readonly status: "ok";
      readonly serverKey: string;
      readonly closedRuntime: boolean;
      readonly toolCount: number;
    }
  | {
      readonly status: "unknown_server";
      readonly serverKey: string;
    }
  | {
      readonly status: "failed";
      readonly serverKey: string;
      readonly closedRuntime: boolean;
      readonly message: string;
    };

export type McpCommandServices = {
  readonly initializeFromConfig: (oauthUi: OAuthUi | null) => Promise<void>;
  readonly getConfiguredDefinitions: () => ReadonlyMap<string, McpServerDefinition>;
  readonly getSessionEnabledServers: () => ReadonlySet<string>;
  readonly setSessionEnabledServers: (enabledServers: Set<string>) => void;
  readonly persistSessionServerSelection: () => void;
  readonly getServerStatuses: () => readonly McpCommandServerStatus[];
  readonly getServerTools: (serverKey: string | null) => McpCommandToolsResult;
  readonly reconnectServer: (
    serverKey: string,
    oauthUi: OAuthUi | null,
  ) => Promise<McpCommandReconnectResult>;
};

export type ParsedMcpCommandArgs =
  | { readonly kind: "toggle" }
  | { readonly kind: "status" }
  | { readonly kind: "tools"; readonly serverKey: string | null }
  | { readonly kind: "reconnect"; readonly serverKey: string }
  | { readonly kind: "help" }
  | { readonly kind: "invalid"; readonly message: string };

const firstLine = (message: string): string => {
  const line = message.split("\n", 1)[0]?.trim() ?? "";
  if (line.length <= 180) {
    return line;
  }

  return `${line.slice(0, 177)}...`;
};

export const parseMcpCommandArgs = (args: string): ParsedMcpCommandArgs => {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    return { kind: "toggle" };
  }

  const parts = trimmed.split(/\s+/);
  const subcommand = parts[0]?.toLowerCase();
  if (subcommand === undefined) {
    return { kind: "toggle" };
  }

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }

  if (subcommand === "status") {
    if (parts.length !== 1) {
      return {
        kind: "invalid",
        message: "/mcp status does not accept extra arguments.",
      };
    }

    return { kind: "status" };
  }

  if (subcommand === "tools") {
    if (parts.length > 2) {
      return {
        kind: "invalid",
        message: "/mcp tools accepts at most one server key.",
      };
    }

    return {
      kind: "tools",
      serverKey: parts[1] ?? null,
    };
  }

  if (subcommand === "reconnect") {
    if (parts.length !== 2) {
      return {
        kind: "invalid",
        message: "/mcp reconnect requires exactly one server key.",
      };
    }

    return {
      kind: "reconnect",
      serverKey: parts[1] ?? "",
    };
  }

  return {
    kind: "invalid",
    message: `Unknown /mcp subcommand: ${parts[0]}`,
  };
};

const makeCompletionItem = (
  value: string,
  label: string,
  description: string,
): AutocompleteItem => ({
  value,
  label,
  description,
});

const completeSubcommands = (prefix: string): AutocompleteItem[] | null => {
  const normalizedPrefix = prefix.trimStart().toLowerCase();
  const leadingWhitespace = prefix.slice(0, prefix.length - prefix.trimStart().length);
  const matches = MCP_SUBCOMMANDS.filter((subcommand) =>
    subcommand.name.startsWith(normalizedPrefix),
  ).map((subcommand) =>
    makeCompletionItem(
      `${leadingWhitespace}${subcommand.value}`,
      subcommand.name,
      subcommand.description,
    ),
  );

  return matches.length > 0 ? matches : null;
};

export const getMcpCommandArgumentCompletions = (
  prefix: string,
  serverKeys: readonly string[],
): AutocompleteItem[] | null => {
  const trimmedStart = prefix.trimStart();
  if (!trimmedStart.includes(" ")) {
    return completeSubcommands(prefix);
  }

  const leadingWhitespace = prefix.slice(0, prefix.length - trimmedStart.length);
  const firstSpaceIndex = trimmedStart.search(/\s/);
  if (firstSpaceIndex < 0) {
    return completeSubcommands(prefix);
  }

  const subcommand = trimmedStart.slice(0, firstSpaceIndex).toLowerCase();
  const rawServerPrefix = trimmedStart.slice(firstSpaceIndex).trimStart();
  const commandSpacing = trimmedStart.slice(firstSpaceIndex, trimmedStart.length - rawServerPrefix.length);

  if (subcommand !== "reconnect" && subcommand !== "tools") {
    return null;
  }

  const hasExtraArgument = rawServerPrefix.trim().includes(" ");
  if (hasExtraArgument) {
    return null;
  }

  const normalizedServerPrefix = rawServerPrefix.toLowerCase();
  const matches = serverKeys
    .filter((serverKey) => serverKey.toLowerCase().startsWith(normalizedServerPrefix))
    .sort((left, right) => left.localeCompare(right))
    .map((serverKey) =>
      makeCompletionItem(
        `${leadingWhitespace}${subcommand}${commandSpacing}${serverKey}`,
        serverKey,
        subcommand === "reconnect"
          ? `Reconnect MCP server ${serverKey}`
          : `List tools for MCP server ${serverKey}`,
      ),
    );

  return matches.length > 0 ? matches : null;
};

export const renderMcpCommandHelp = (): string =>
  [
    MCP_COMMAND_USAGE,
    "",
    "Subcommands:",
    "- /mcp status: show configured servers, tool counts, connection state, and auth state.",
    "- /mcp tools [server]: list discovered or cached tools.",
    "- /mcp reconnect <server>: close the runtime and refresh tool discovery.",
    "",
    "With no arguments, /mcp opens the interactive session enable/disable picker.",
  ].join("\n");

export const renderMcpCommandStatus = (
  statuses: readonly McpCommandServerStatus[],
): string => {
  if (statuses.length === 0) {
    return "No MCP servers are configured.";
  }

  const lines = ["MCP servers:"];
  for (const status of statuses) {
    const configured = status.configuredEnabled ? "default enabled" : "default disabled";
    const session = status.sessionEnabled ? "session enabled" : "session disabled";
    const transport = status.transport === null ? status.serverType : `${status.serverType}/${status.transport}`;
    const failure =
      status.lastFailureMessage === null
        ? ""
        : ` · last failure=${firstLine(status.lastFailureMessage)}`;

    lines.push(
      `- ${status.serverKey} · ${session} · ${configured} · ${transport} · tools cached=${status.cachedToolCount} discovered=${status.discoveredToolCount} · connection=${status.connectionStatus} · auth=${status.authStatus}${failure}`,
    );
  }

  lines.push("", "Use /mcp to toggle session enablement, /mcp reconnect <server> to refresh discovery.");
  return lines.join("\n");
};

export const renderMcpCommandTools = (
  result: McpCommandToolsResult,
): string => {
  if (result.status === "unknown_server") {
    return `Unknown MCP server: ${result.serverKey}`;
  }

  if (result.serverTools.length === 0) {
    return "No MCP servers are configured.";
  }

  const lines = ["MCP tools:"];
  for (const serverTools of result.serverTools) {
    const source =
      serverTools.source === "none"
        ? "none"
        : serverTools.source === "cached"
          ? "cached"
          : "discovered";
    lines.push(
      "",
      `${serverTools.serverKey} · source=${source} · cached=${serverTools.cachedToolCount} discovered=${serverTools.discoveredToolCount}`,
    );

    if (serverTools.tools.length === 0) {
      lines.push("  No discovered or cached tools. Use /mcp reconnect <server> to refresh discovery.");
      continue;
    }

    for (const tool of serverTools.tools) {
      lines.push(`  - ${tool.piToolName}: ${firstLine(tool.description)}`);
    }
  }

  return lines.join("\n");
};

export const renderMcpCommandReconnectResult = (
  result: McpCommandReconnectResult,
): string => {
  if (result.status === "unknown_server") {
    return `Unknown MCP server: ${result.serverKey}`;
  }

  if (result.status === "failed") {
    return [
      `Failed to reconnect MCP server ${result.serverKey}.`,
      `Closed existing runtime: ${result.closedRuntime ? "yes" : "no"}.`,
      `Reason: ${result.message}`,
    ].join("\n");
  }

  return [
    `Reconnected MCP server ${result.serverKey}.`,
    `Closed existing runtime: ${result.closedRuntime ? "yes" : "no"}.`,
    `Refreshed discovery metadata: ${result.toolCount} tool${result.toolCount === 1 ? "" : "s"}.`,
  ].join("\n");
};

const sendCommandOutput = (
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  text: string,
  level: McpCommandOutputLevel = "info",
): void => {
  if (!ctx.hasUI && isTextPrintMode(process.argv)) {
    const output = `${text}\n`;
    if (level === "error") {
      process.stderr.write(output);
      return;
    }

    process.stdout.write(output);
    return;
  }

  pi.sendMessage<McpCommandOutputDetails>({
    customType: MCP_COMMAND_OUTPUT_TYPE,
    content: text,
    display: true,
    details: { level },
  });
};

const createOAuthUi = (ctx: ExtensionCommandContext): OAuthUi | null =>
  ctx.hasUI
    ? {
        notify: ctx.ui.notify.bind(ctx.ui),
        input: ctx.ui.input.bind(ctx.ui),
      }
    : null;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const getCliMode = (argv: readonly string[]): "text" | "json" | "rpc" => {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") {
      const value = argv[index + 1];
      if (value === "json" || value === "rpc" || value === "text") {
        return value;
      }
    }

    if (arg === "--mode=json") {
      return "json";
    }

    if (arg === "--mode=rpc") {
      return "rpc";
    }

    if (arg === "--mode=text") {
      return "text";
    }
  }

  return "text";
};

const isTextPrintMode = (argv: readonly string[]): boolean =>
  argv.some((arg) => arg === "--print" || arg === "-p") && getCliMode(argv) === "text";

const runSessionPicker = async (
  ctx: ExtensionCommandContext,
  services: McpCommandServices,
  oauthUi: OAuthUi,
): Promise<void> => {
  await services.initializeFromConfig(oauthUi);

  const configuredDefinitionsByKey = services.getConfiguredDefinitions();
  if (configuredDefinitionsByKey.size === 0) {
    ctx.ui.notify("No MCP servers are configured.", "warning");
    return;
  }

  const desiredEnabledServers = new Set(services.getSessionEnabledServers());
  const sortedServerNames = Array.from(configuredDefinitionsByKey.keys()).sort((a, b) =>
    a.localeCompare(b),
  );

  const { selectSessionDiscoverabilityChoice } = await import("./session-picker.js");

  while (true) {
    const choice = await selectSessionDiscoverabilityChoice(
      ctx,
      sortedServerNames,
      desiredEnabledServers,
    );

    if (choice === undefined || choice === null || choice === "__done__") {
      break;
    }

    if (choice === "__enable_all__") {
      for (const serverName of sortedServerNames) {
        desiredEnabledServers.add(serverName);
      }
      continue;
    }

    if (choice === "__disable_all__") {
      desiredEnabledServers.clear();
      continue;
    }

    if (!configuredDefinitionsByKey.has(choice)) {
      continue;
    }

    if (desiredEnabledServers.has(choice)) {
      desiredEnabledServers.delete(choice);
    } else {
      desiredEnabledServers.add(choice);
    }
  }

  const previousEnabledServers = new Set(services.getSessionEnabledServers());
  const nextEnabledServers = new Set<string>();

  for (const serverKey of desiredEnabledServers) {
    if (configuredDefinitionsByKey.has(serverKey)) {
      nextEnabledServers.add(serverKey);
    }
  }

  const hasChanged =
    previousEnabledServers.size !== nextEnabledServers.size ||
    Array.from(previousEnabledServers).some((serverKey) => !nextEnabledServers.has(serverKey));

  services.setSessionEnabledServers(nextEnabledServers);

  if (hasChanged) {
    services.persistSessionServerSelection();
  }
};

export const registerMcpCommand = (
  pi: ExtensionAPI,
  services: McpCommandServices,
): void => {
  pi.registerCommand("mcp", {
    description: "Enable, inspect, or reconnect MCP servers",
    getArgumentCompletions: async (prefix: string): Promise<AutocompleteItem[] | null> => {
      try {
        await services.initializeFromConfig(null);
      } catch {
        return completeSubcommands(prefix);
      }

      return getMcpCommandArgumentCompletions(
        prefix,
        Array.from(services.getConfiguredDefinitions().keys()),
      );
    },
    handler: async (args, ctx) => {
      const parsedArgs = parseMcpCommandArgs(args);
      const oauthUi = createOAuthUi(ctx);

      if (parsedArgs.kind === "toggle") {
        if (oauthUi === null) {
          return;
        }

        try {
          await services.initializeFromConfig(oauthUi);
        } catch (error) {
          sendCommandOutput(pi, ctx, `MCP config load failed: ${getErrorMessage(error)}`, "error");
          return;
        }

        await runSessionPicker(ctx, services, oauthUi);
        return;
      }

      if (parsedArgs.kind === "help") {
        sendCommandOutput(pi, ctx, renderMcpCommandHelp());
        return;
      }

      if (parsedArgs.kind === "invalid") {
        sendCommandOutput(
          pi,
          ctx,
          `${parsedArgs.message}\n\n${renderMcpCommandHelp()}`,
          "warning",
        );
        return;
      }

      try {
        await services.initializeFromConfig(oauthUi);
      } catch (error) {
        sendCommandOutput(pi, ctx, `MCP config load failed: ${getErrorMessage(error)}`, "error");
        return;
      }

      if (parsedArgs.kind === "status") {
        sendCommandOutput(pi, ctx, renderMcpCommandStatus(services.getServerStatuses()));
        return;
      }

      if (parsedArgs.kind === "tools") {
        const result = services.getServerTools(parsedArgs.serverKey);
        sendCommandOutput(
          pi,
          ctx,
          renderMcpCommandTools(result),
          result.status === "unknown_server" ? "warning" : "info",
        );
        return;
      }

      const result = await services.reconnectServer(parsedArgs.serverKey, oauthUi);
      sendCommandOutput(
        pi,
        ctx,
        renderMcpCommandReconnectResult(result),
        result.status === "ok" ? "info" : "warning",
      );
    },
  });
};
