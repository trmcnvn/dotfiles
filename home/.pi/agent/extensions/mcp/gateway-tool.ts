import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  exposesRawMcpOutputDetails,
  formatMcpToolErrorMessage,
  formatMcpToolOutput,
} from "./output-policy.js";
import type {
  McpRegisteredTool,
  McpRuntime,
  McpServerDefinition,
  OAuthUi,
  TruncateContentResult,
  JsonRecord,
} from "./types.js";
import { OpenObjectParams } from "./schema.js";
import {
  coerceStringRecord,
  createProxyTextResult,
  formatPromptMessages,
  formatReadResourceResult,
} from "./content-format.js";
import { getRequestTimeoutMs } from "./transport.js";
import { listAllPrompts, listAllResources } from "./runtime.js";
import type { McpToolSearchResult } from "./search.js";
import {
  renderProxyStatus,
  renderServerPromptList,
  renderServerResourceList,
  renderServerToolList,
  renderToolDescription,
  renderToolSearch,
} from "./renderers.js";
import { isNonEmptyString, isRecord } from "./utils.js";

type McpResolvedTool = {
  readonly definition: McpServerDefinition;
  readonly tool: McpRegisteredTool;
};

type McpToolInvocationResult = {
  readonly output: TruncateContentResult;
  readonly isError: boolean;
  readonly structuredContent: JsonRecord | null;
};

export type McpGatewayServices = {
  readonly initializeFromConfig: (oauthUi: OAuthUi | null) => Promise<void>;
  readonly getConfiguredDefinitions: () => ReadonlyMap<string, McpServerDefinition>;
  readonly getSessionEnabledServers: () => ReadonlySet<string>;
  readonly createAuthorizationCodeRequester: (oauthUi: OAuthUi | null) => ((serverKey: string, authorizationUrl: URL) => Promise<string>) | null;
  readonly inferServerKeyFromToolReference: (toolReference: string) => string | null;
  readonly ensureToolsForServer: (serverKey: string, requestAuthorizationCode: ((serverKey: string, authorizationUrl: URL) => Promise<string>) | null, forceRefresh?: boolean, signal?: AbortSignal) => Promise<readonly McpRegisteredTool[]>;
  readonly hasDiscoveredTools: (serverKey: string) => boolean;
  readonly resolveToolReference: (toolReference: string, serverKey?: string) => McpResolvedTool | null;
  readonly getOrCreateRuntime: (definition: McpServerDefinition) => McpRuntime;
  readonly invokeMcpTool: (runtime: McpRuntime, registeredTool: McpRegisteredTool, params: Record<string, unknown>, toolOauthUi: OAuthUi | null, signal?: AbortSignal) => Promise<McpToolInvocationResult>;
  readonly isServerEnabledForSession: (serverKey: string) => boolean;
  readonly withConnectedClient: <T>(definition: McpServerDefinition, requestAuthorizationCode: ((serverKey: string, authorizationUrl: URL) => Promise<string>) | null, operation: (runtime: McpRuntime, client: Client) => Promise<T>, signal?: AbortSignal) => Promise<T>;
  readonly getSearchScopeServerKeys: (serverKey?: string) => readonly string[];
  readonly ensureServerMetadata: (definition: McpServerDefinition, requestAuthorizationCode: ((serverKey: string, authorizationUrl: URL) => Promise<string>) | null, forceRefresh?: boolean, signal?: AbortSignal) => Promise<readonly McpRegisteredTool[]>;
  readonly findToolMatches: (query: string, serverKey: string | undefined, regex: boolean) => McpToolSearchResult;
  readonly hasUndiscoveredSearchScope: (serverKey?: string) => boolean;
  readonly refreshDiscoveryScopeBestEffort: (serverKey?: string, signal?: AbortSignal) => Promise<void>;
};

export const registerMcpGatewayTool = (
  pi: ExtensionAPI,
  services: McpGatewayServices,
): void => {
  pi.registerTool({
    name: "mcp",
    label: "MCP",
    description:
      "Compact MCP gateway. Search, list, describe, and call MCP tools without exposing every discovered MCP tool in the prompt.",
    parameters: Type.Object({
      server: Type.Optional(
        Type.String({ description: "MCP server key to inspect or use" }),
      ),
      search: Type.Optional(
        Type.String({ description: "Search discovered MCP tools" }),
      ),
      regex: Type.Optional(
        Type.Boolean({ description: "Treat search as a regular expression" }),
      ),
      includeSchemas: Type.Optional(
        Type.Boolean({ description: "Include input schemas in search results" }),
      ),
      describe: Type.Optional(
        Type.String({ description: "Describe a tool by full name or raw MCP name" }),
      ),
      tool: Type.Optional(
        Type.String({ description: "Call a tool by full name or raw MCP name" }),
      ),
      listPrompts: Type.Optional(
        Type.Boolean({ description: "List prompts exposed by the server" }),
      ),
      getPrompt: Type.Optional(
        Type.String({ description: "Get a prompt by name from the server" }),
      ),
      listResources: Type.Optional(
        Type.Boolean({ description: "List resources exposed by the server" }),
      ),
      readResource: Type.Optional(
        Type.String({ description: "Read a resource by URI from the server" }),
      ),
      args: Type.Optional(OpenObjectParams),
      refresh: Type.Optional(
        Type.Boolean({ description: "Refresh discovery metadata before reading it" }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, toolCtx) {
      const toolOauthUi: OAuthUi | null = toolCtx.hasUI
        ? {
            notify: toolCtx.ui.notify.bind(toolCtx.ui),
            input: toolCtx.ui.input.bind(toolCtx.ui),
          }
        : null;

      await services.initializeFromConfig(toolOauthUi);

      const configuredDefinitionsByKey = services.getConfiguredDefinitions();

      if (configuredDefinitionsByKey.size === 0) {
        return {
          content: [{ type: "text", text: "No MCP servers are configured." }],
          details: { mode: "status" },
        };
      }

      const requestAuthorizationCode = services.createAuthorizationCodeRequester(toolOauthUi);
      const serverKey = isNonEmptyString(params.server) ? params.server.trim() : undefined;
      const refresh = params.refresh === true;

      if (isNonEmptyString(params.tool)) {
        const toolReference = params.tool.trim();
        const hintedServerKey = serverKey ?? services.inferServerKeyFromToolReference(toolReference) ?? undefined;

        if (hintedServerKey !== undefined) {
          await services.ensureToolsForServer(
            hintedServerKey,
            requestAuthorizationCode,
            refresh || !services.hasDiscoveredTools(hintedServerKey),
            signal,
          );
        }

        const resolvedTool = services.resolveToolReference(toolReference, serverKey);
        if (resolvedTool === null) {
          throw new Error(
            `Unknown MCP tool: ${toolReference}. Use mcp({ search: \"...\" }) or mcp({ server: \"...\" }) to inspect available tools.`,
          );
        }

        const runtime = services.getOrCreateRuntime(resolvedTool.definition);
        const result = await services.invokeMcpTool(
          runtime,
          resolvedTool.tool,
          isRecord(params.args) ? params.args : {},
          toolOauthUi,
          signal,
        );

        if (result.isError) {
          throw new Error(
            formatMcpToolErrorMessage(
              resolvedTool.definition.key,
              resolvedTool.tool.mcpToolName,
              resolvedTool.tool.outputMode,
              result.output.text,
            ),
          );
        }

        const exposesRawOutput = exposesRawMcpOutputDetails(resolvedTool.tool.outputMode);

        return {
          content: [
            {
              type: "text",
              text: formatMcpToolOutput(resolvedTool.tool.outputMode, result.output.text),
            },
          ],
          details: {
            mode: "tool",
            server: resolvedTool.definition.key,
            mcpTool: resolvedTool.tool.mcpToolName,
            outputMode: resolvedTool.tool.outputMode,
            truncated: result.output.truncated,
            fullOutputPath: exposesRawOutput ? result.output.fullOutputPath : null,
            structuredContent: exposesRawOutput ? result.structuredContent : null,
          },
        };
      }

      if (isNonEmptyString(params.describe)) {
        const toolReference = params.describe.trim();
        const hintedServerKey = serverKey ?? services.inferServerKeyFromToolReference(toolReference) ?? undefined;

        if (hintedServerKey !== undefined) {
          await services.ensureToolsForServer(
            hintedServerKey,
            requestAuthorizationCode,
            refresh || !services.hasDiscoveredTools(hintedServerKey),
            signal,
          );
        }

        const resolvedTool = services.resolveToolReference(toolReference, serverKey);
        if (resolvedTool === null) {
          throw new Error(
            `Unknown MCP tool: ${toolReference}. Use mcp({ search: \"...\" }) or mcp({ server: \"...\" }) first.`,
          );
        }

        return await createProxyTextResult(
          renderToolDescription(resolvedTool.definition.key, resolvedTool.tool),
          {
            mode: "describe",
            server: resolvedTool.definition.key,
            mcpTool: resolvedTool.tool.mcpToolName,
          },
        );
      }

      if (params.listPrompts === true) {
        if (serverKey === undefined) {
          throw new Error("mcp({ listPrompts: true }) requires a server key.");
        }

        const definition = configuredDefinitionsByKey.get(serverKey);
        if (definition === undefined) {
          throw new Error(`Unknown MCP server: ${serverKey}`);
        }
        if (!services.isServerEnabledForSession(serverKey)) {
          throw new Error(
            `MCP server ${serverKey} is disabled in this session. Use /mcp to enable it.`,
          );
        }

        const prompts = await services.withConnectedClient(
          definition,
          requestAuthorizationCode,
          async (_runtime, client) =>
            await listAllPrompts(client, getRequestTimeoutMs(definition), signal),
          signal,
        );

        return await createProxyTextResult(renderServerPromptList(serverKey, prompts), {
          mode: "listPrompts",
          server: serverKey,
          promptCount: prompts.length,
        });
      }

      if (isNonEmptyString(params.getPrompt)) {
        if (serverKey === undefined) {
          throw new Error("mcp({ getPrompt: \"...\" }) requires a server key.");
        }

        const definition = configuredDefinitionsByKey.get(serverKey);
        if (definition === undefined) {
          throw new Error(`Unknown MCP server: ${serverKey}`);
        }
        if (!services.isServerEnabledForSession(serverKey)) {
          throw new Error(
            `MCP server ${serverKey} is disabled in this session. Use /mcp to enable it.`,
          );
        }

        const promptName = params.getPrompt.trim();
        const promptArguments = coerceStringRecord(params.args);
        const promptResult = await services.withConnectedClient(
          definition,
          requestAuthorizationCode,
          async (_runtime, client) =>
            await client.getPrompt(
              {
                name: promptName,
                arguments:
                  Object.keys(promptArguments).length === 0 ? undefined : promptArguments,
              },
              { timeout: getRequestTimeoutMs(definition), signal },
            ),
          signal,
        );

        return await createProxyTextResult(
          [`Prompt: ${promptName}`, "", formatPromptMessages(promptResult.messages)].join(
            "\n",
          ),
          {
            mode: "getPrompt",
            server: serverKey,
            prompt: promptName,
          },
        );
      }

      if (params.listResources === true) {
        if (serverKey === undefined) {
          throw new Error("mcp({ listResources: true }) requires a server key.");
        }

        const definition = configuredDefinitionsByKey.get(serverKey);
        if (definition === undefined) {
          throw new Error(`Unknown MCP server: ${serverKey}`);
        }
        if (!services.isServerEnabledForSession(serverKey)) {
          throw new Error(
            `MCP server ${serverKey} is disabled in this session. Use /mcp to enable it.`,
          );
        }

        const resources = await services.withConnectedClient(
          definition,
          requestAuthorizationCode,
          async (_runtime, client) =>
            await listAllResources(client, getRequestTimeoutMs(definition), signal),
          signal,
        );

        return await createProxyTextResult(
          renderServerResourceList(serverKey, resources),
          {
            mode: "listResources",
            server: serverKey,
            resourceCount: resources.length,
          },
        );
      }

      if (isNonEmptyString(params.readResource)) {
        if (serverKey === undefined) {
          throw new Error("mcp({ readResource: \"...\" }) requires a server key.");
        }

        const definition = configuredDefinitionsByKey.get(serverKey);
        if (definition === undefined) {
          throw new Error(`Unknown MCP server: ${serverKey}`);
        }
        if (!services.isServerEnabledForSession(serverKey)) {
          throw new Error(
            `MCP server ${serverKey} is disabled in this session. Use /mcp to enable it.`,
          );
        }

        const resourceUri = params.readResource.trim();
        const resourceResult = await services.withConnectedClient(
          definition,
          requestAuthorizationCode,
          async (_runtime, client) =>
            await client.readResource(
              { uri: resourceUri },
              { timeout: getRequestTimeoutMs(definition), signal },
            ),
          signal,
        );

        return await createProxyTextResult(
          formatReadResourceResult(resourceResult),
          {
            mode: "readResource",
            server: serverKey,
            uri: resourceUri,
          },
        );
      }

      if (isNonEmptyString(params.search)) {
        const searchQuery = params.search.trim();
        const regex = params.regex === true;
        const includeSchemas = params.includeSchemas === true;

        if (serverKey !== undefined) {
          await services.ensureToolsForServer(
            serverKey,
            requestAuthorizationCode,
            refresh || !services.hasDiscoveredTools(serverKey),
            signal,
          );
        } else if (refresh) {
          for (const candidateServerKey of services.getSearchScopeServerKeys()) {
            const definition = configuredDefinitionsByKey.get(candidateServerKey);
            if (definition === undefined) {
              continue;
            }

            await services.ensureServerMetadata(definition, requestAuthorizationCode, true, signal);
          }
        }

        let searchResult = services.findToolMatches(searchQuery, serverKey, regex);
        if (searchResult.status === "invalid_regex") {
          throw new Error(searchResult.message);
        }
        let matches = searchResult.matches;
        let autoRefreshed = false;

        if (!refresh && matches.length === 0 && services.hasUndiscoveredSearchScope(serverKey)) {
          await services.refreshDiscoveryScopeBestEffort(serverKey, signal);
          searchResult = services.findToolMatches(searchQuery, serverKey, regex);
          if (searchResult.status === "invalid_regex") {
            throw new Error(searchResult.message);
          }
          matches = searchResult.matches;
          autoRefreshed = true;
        }

        return await createProxyTextResult(
          renderToolSearch(
            searchQuery,
            matches,
            refresh || autoRefreshed,
            autoRefreshed,
            includeSchemas,
          ),
          {
            mode: "search",
            refreshed: refresh || autoRefreshed,
            autoRefreshed,
            regex,
            includeSchemas,
            resultCount: matches.length,
          },
        );
      }

      if (serverKey !== undefined) {
        const tools = await services.ensureToolsForServer(
          serverKey,
          requestAuthorizationCode,
          refresh || !services.hasDiscoveredTools(serverKey),
          signal,
        );

        return await createProxyTextResult(renderServerToolList(serverKey, tools, configuredDefinitionsByKey), {
          mode: "list",
          server: serverKey,
          refreshed: refresh,
          toolCount: tools.length,
        });
      }

      return await createProxyTextResult(renderProxyStatus(configuredDefinitionsByKey, services.getSessionEnabledServers()), { mode: "status" });
    },
  });
};
