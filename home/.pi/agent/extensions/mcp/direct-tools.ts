import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import {
  exposesRawMcpOutputDetails,
  formatMcpToolErrorMessage,
  formatMcpToolOutput,
} from "./output-policy.js";
import { OpenObjectParams } from "./schema.js";
import type {
  JsonRecord,
  McpRegisteredTool,
  McpRuntime,
  McpServerDefinition,
  OAuthUi,
  TruncateContentResult,
} from "./types.js";
import { isNonEmptyString, isRecord, sanitizeNameToken } from "./utils.js";

export const MCP_DIRECT_TOOLS_ENV_VAR = "MCP_DIRECT_TOOLS";

const BUILT_IN_OR_GATEWAY_TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "mcp",
] as const;

type DirectMcpToolInvocationResult = {
  readonly output: TruncateContentResult;
  readonly isError: boolean;
  readonly structuredContent: JsonRecord | null;
};

export type DirectMcpToolDetails = {
  readonly mode: "directTool";
  readonly server: string;
  readonly mcpTool: string;
  readonly outputMode: McpRegisteredTool["outputMode"];
  readonly truncated: boolean;
  readonly fullOutputPath: string | null;
  readonly structuredContent: JsonRecord | null;
};

export type DirectMcpToolDefinition = ToolDefinition<
  typeof OpenObjectParams,
  DirectMcpToolDetails
>;

export type DirectMcpToolServices = {
  readonly initializeFromConfig: (oauthUi: OAuthUi | null) => Promise<void>;
  readonly getOrCreateRuntime: (definition: McpServerDefinition) => McpRuntime;
  readonly invokeMcpTool: (
    runtime: McpRuntime,
    registeredTool: McpRegisteredTool,
    params: Record<string, unknown>,
    toolOauthUi: OAuthUi | null,
    signal?: AbortSignal,
  ) => Promise<DirectMcpToolInvocationResult>;
};

export type DirectMcpToolRegistrar = {
  readonly getAllTools: () => readonly { readonly name: string }[];
  readonly registerTool: (tool: DirectMcpToolDefinition) => void;
};

export type RegisterDirectMcpToolsOptions = {
  readonly definitions: readonly McpServerDefinition[];
  readonly discoveredToolsByServer: ReadonlyMap<string, readonly McpRegisteredTool[]>;
  readonly services: DirectMcpToolServices;
  readonly envValue?: string;
  readonly warn: (message: string) => void;
};

const addAllowlistedTool = (
  allowlists: Map<string, Set<string>>,
  serverKey: string,
  toolName: string,
): void => {
  const existing = allowlists.get(serverKey);
  if (existing !== undefined) {
    existing.add(toolName);
    return;
  }

  allowlists.set(serverKey, new Set([toolName]));
};

export const parseMcpDirectToolsEnv = (
  value: string | undefined,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const allowlists = new Map<string, Set<string>>();
  if (!isNonEmptyString(value)) {
    return allowlists;
  }

  for (const rawEntry of value.split(",")) {
    const entry = rawEntry.trim();
    const separatorIndex = entry.indexOf("/");
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      continue;
    }

    const serverKey = sanitizeNameToken(entry.slice(0, separatorIndex));
    const toolName = entry.slice(separatorIndex + 1).trim();
    if (toolName.length === 0) {
      continue;
    }

    addAllowlistedTool(allowlists, serverKey, toolName);
  }

  return allowlists;
};

export const resolveDirectToolAllowlists = (
  definitions: readonly McpServerDefinition[],
  envValue = process.env[MCP_DIRECT_TOOLS_ENV_VAR],
): ReadonlyMap<string, ReadonlySet<string>> => {
  const allowlists = new Map<string, Set<string>>();

  for (const definition of definitions) {
    for (const toolName of definition.directTools) {
      addAllowlistedTool(allowlists, definition.key, toolName);
    }
  }

  for (const [serverKey, toolNames] of parseMcpDirectToolsEnv(envValue)) {
    for (const toolName of toolNames) {
      addAllowlistedTool(allowlists, serverKey, toolName);
    }
  }

  return allowlists;
};

const findAllowlistedTool = (
  allowlistEntry: string,
  tools: readonly McpRegisteredTool[],
): McpRegisteredTool | undefined =>
  tools.find((tool) => allowlistEntry === tool.mcpToolName) ??
  tools.find((tool) => allowlistEntry === tool.piToolName) ??
  tools.find((tool) => allowlistEntry === sanitizeNameToken(tool.mcpToolName));

const getExistingToolNames = (
  pi: DirectMcpToolRegistrar,
  warn: (message: string) => void,
): Set<string> => {
  const existingToolNames = new Set<string>(BUILT_IN_OR_GATEWAY_TOOL_NAMES);

  try {
    for (const tool of pi.getAllTools()) {
      existingToolNames.add(tool.name);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(
      `Could not inspect existing Pi tools before registering MCP direct tools: ${message}. Only built-in collision checks were applied.`,
    );
  }

  return existingToolNames;
};

const createDirectMcpToolDefinition = (
  definition: McpServerDefinition,
  registeredTool: McpRegisteredTool,
  services: DirectMcpToolServices,
): DirectMcpToolDefinition => ({
  name: registeredTool.piToolName,
  label: registeredTool.piToolName,
  description: registeredTool.description,
  parameters: OpenObjectParams,
  async execute(_toolCallId, params, signal, _onUpdate, toolCtx) {
    const toolOauthUi: OAuthUi | null = toolCtx.hasUI
      ? {
          notify: toolCtx.ui.notify.bind(toolCtx.ui),
          input: toolCtx.ui.input.bind(toolCtx.ui),
        }
      : null;

    await services.initializeFromConfig(toolOauthUi);

    const runtime = services.getOrCreateRuntime(definition);
    const result = await services.invokeMcpTool(
      runtime,
      registeredTool,
      isRecord(params) ? params : {},
      toolOauthUi,
      signal,
    );

    if (result.isError) {
      throw new Error(
        formatMcpToolErrorMessage(
          definition.key,
          registeredTool.mcpToolName,
          registeredTool.outputMode,
          result.output.text,
        ),
      );
    }

    const exposesRawOutput = exposesRawMcpOutputDetails(registeredTool.outputMode);

    return {
      content: [
        {
          type: "text",
          text: formatMcpToolOutput(registeredTool.outputMode, result.output.text),
        },
      ],
      details: {
        mode: "directTool",
        server: definition.key,
        mcpTool: registeredTool.mcpToolName,
        outputMode: registeredTool.outputMode,
        truncated: result.output.truncated,
        fullOutputPath: exposesRawOutput ? result.output.fullOutputPath : null,
        structuredContent: exposesRawOutput ? result.structuredContent : null,
      },
    };
  },
});

export const registerDirectMcpTools = (
  pi: DirectMcpToolRegistrar,
  options: RegisterDirectMcpToolsOptions,
): readonly string[] => {
  const allowlists = resolveDirectToolAllowlists(
    options.definitions,
    options.envValue,
  );
  if (allowlists.size === 0) {
    return [];
  }

  const existingToolNames = getExistingToolNames(pi, options.warn);
  const registeredToolNames: string[] = [];

  for (const definition of options.definitions) {
    const allowlistedToolNames = allowlists.get(definition.key);
    if (allowlistedToolNames === undefined || allowlistedToolNames.size === 0) {
      continue;
    }

    const cachedTools = options.discoveredToolsByServer.get(definition.key);
    if (cachedTools === undefined) {
      options.warn(
        `MCP direct tools for server ${definition.key} were allowlisted but skipped because no valid discovery cache is available. Use mcp({ server: "${definition.key}", refresh: true }) to refresh discovery, then reload Pi to register direct tools.`,
      );
      continue;
    }

    const selectedToolNames = new Set<string>();
    for (const allowlistedToolName of allowlistedToolNames) {
      const registeredTool = findAllowlistedTool(allowlistedToolName, cachedTools);

      if (registeredTool === undefined) {
        options.warn(
          `MCP direct tool ${definition.key}/${allowlistedToolName} was allowlisted but was not found in the valid discovery cache. Use mcp({ server: "${definition.key}", refresh: true }) to refresh discovery, then reload Pi to register direct tools.`,
        );
        continue;
      }

      if (selectedToolNames.has(registeredTool.piToolName)) {
        continue;
      }
      selectedToolNames.add(registeredTool.piToolName);

      if (existingToolNames.has(registeredTool.piToolName)) {
        options.warn(
          `MCP direct tool ${registeredTool.piToolName} (${definition.key}/${registeredTool.mcpToolName}) conflicts with an existing Pi tool and was not registered.`,
        );
        continue;
      }

      pi.registerTool(
        createDirectMcpToolDefinition(definition, registeredTool, options.services),
      );
      existingToolNames.add(registeredTool.piToolName);
      registeredToolNames.push(registeredTool.piToolName);
    }
  }

  return registeredToolNames;
};
