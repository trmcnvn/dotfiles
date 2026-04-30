import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  registerMcpCommand,
  type McpCommandConnectionStatus,
  type McpCommandReconnectResult,
  type McpCommandServerStatus,
  type McpCommandServerTools,
  type McpCommandToolSource,
  type McpCommandToolsResult,
} from "./commands.js";
import {
  INTERACTIVE_AUTH_TIMEOUT_MS,
  MCP_AUTH_STATE_PATH,
  MCP_DISCOVERY_CACHE_PATH,
  MCP_SESSION_CONFIG_TYPE,
  OAUTH_CALLBACK_WAIT_TIMEOUT_MS,
} from "./constants.js";
import type {
  JsonRecord,
  McpRegisteredTool,
  McpRuntime,
  McpServerDefinition,
  McpSessionState,
  OAuthUi,
  PersistedMcpDiscoveryFile,
  PersistedMcpDiscoveryState,
  PersistedMcpOAuthFile,
  PersistedMcpOAuthState,
} from "./types.js";
import { computeDefinitionHash, isPersistedDiscoveryStateFresh, loadMcpConfig } from "./config.js";
import { formatToolContent, truncateContent } from "./content-format.js";
import { registerDirectMcpTools } from "./direct-tools.js";
import { registerMcpGatewayTool } from "./gateway-tool.js";
import { waitForOAuthCallbackCode } from "./oauth.js";
import { findToolMatches as findDiscoveredToolMatches } from "./search.js";
import { parsePersistedMcpDiscoveryFile, parsePersistedMcpOAuthFile } from "./persisted-state.js";
import {
  closeRuntime,
  createRuntime,
  ensureConnected,
  listAllTools,
  withRuntimeLease,
} from "./runtime.js";
import { getRequestTimeoutMs } from "./transport.js";
import { createRegisteredTools, hydrateRegisteredTools } from "./tool-registry.js";
import { isNonEmptyString, isRecord, parseAuthorizationCodeInput, withTimeout } from "./utils.js";

export default function mcpExtension(pi: ExtensionAPI) {
  type McpDiscoverySource = Exclude<McpCommandToolSource, "none">;
  type McpServerConnectionFailure = {
    readonly message: string;
    readonly authRequired: boolean;
  };

  const runtimes = new Map<string, McpRuntime>();
  const discoveredToolsByServer = new Map<string, readonly McpRegisteredTool[]>();
  const discoverySourceByServer = new Map<string, McpDiscoverySource>();
  const connectionFailuresByServer = new Map<string, McpServerConnectionFailure>();
  const configuredDefinitionsByKey = new Map<string, McpServerDefinition>();
  let defaultEnabledServers = new Set<string>();
  let sessionEnabledServers = new Set<string>();
  let initialized = false;
  let initializationPromise: Promise<void> | null = null;
  let authStateLoaded = false;
  let discoveryCacheLoaded = false;
  let authStateWriteQueue: Promise<void> = Promise.resolve();
  let discoveryCacheWriteQueue: Promise<void> = Promise.resolve();
  let lastOAuthUi: OAuthUi | null = null;
  const persistedAuthByServer = new Map<string, PersistedMcpOAuthState>();
  const persistedDiscoveryByServer = new Map<string, PersistedMcpDiscoveryState>();

  const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  const isAuthRequiredFailure = (error: unknown, message: string): boolean =>
    error instanceof UnauthorizedError ||
    /oauth authorization is required|authorization is required|unauthorized|\b401\b/i.test(message);

  const recordConnectionFailure = (serverKey: string, error: unknown): void => {
    const message = getErrorMessage(error);
    connectionFailuresByServer.set(serverKey, {
      message,
      authRequired: isAuthRequiredFailure(error, message),
    });
  };

  const clearConnectionFailure = (serverKey: string): void => {
    connectionFailuresByServer.delete(serverKey);
  };

  const warnMcpDirectToolRegistration = (message: string): void => {
    if (lastOAuthUi !== null) {
      lastOAuthUi.notify(message, "warning");
    }
  };

  const queuePersistedAuthWrite = () => {
    const serialized: PersistedMcpOAuthFile = {
      servers: Object.fromEntries(persistedAuthByServer.entries()),
    };

    authStateWriteQueue = authStateWriteQueue
      .catch(() => {
        // keep queue alive after previous failure
      })
      .then(async () => {
        try {
          await mkdir(dirname(MCP_AUTH_STATE_PATH), { recursive: true });
          await writeFile(
            MCP_AUTH_STATE_PATH,
            `${JSON.stringify(serialized, null, 2)}\n`,
            {
              encoding: "utf8",
              mode: 0o600,
            },
          );
          await chmod(MCP_AUTH_STATE_PATH, 0o600);
        } catch (error) {
          if (lastOAuthUi !== null) {
            const message =
              error instanceof Error ? error.message : "unknown file write error";
            lastOAuthUi.notify(
              `Failed to persist MCP OAuth state: ${message}`,
              "warning",
            );
          }
        }
      });
  };

  const updatePersistedAuthFromRuntime = (runtime: McpRuntime) => {
    if (runtime.definition.type !== "remote" || runtime.oauthState === null) {
      return;
    }

    const oauthState = runtime.oauthState;
    const hasPersistedData =
      oauthState.clientInformation !== undefined ||
      oauthState.tokens !== undefined;

    if (!hasPersistedData) {
      if (persistedAuthByServer.delete(runtime.definition.key)) {
        queuePersistedAuthWrite();
      }
      return;
    }

    persistedAuthByServer.set(runtime.definition.key, {
      url: runtime.definition.url,
      updatedAt: new Date().toISOString(),
      clientInformation: oauthState.clientInformation,
      tokens: oauthState.tokens,
    });
    queuePersistedAuthWrite();
  };

  const ensureAuthStateLoaded = async (oauthUi: OAuthUi | null): Promise<void> => {
    if (authStateLoaded) {
      if (oauthUi !== null) {
        lastOAuthUi = oauthUi;
      }
      return;
    }
    authStateLoaded = true;

    if (oauthUi !== null) {
      lastOAuthUi = oauthUi;
    }

    let rawAuthState: string;
    try {
      rawAuthState = await readFile(MCP_AUTH_STATE_PATH, "utf8");
    } catch (error) {
      const isMissingAuthFile =
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT";

      if (isMissingAuthFile) {
        return;
      }

      if (lastOAuthUi !== null) {
        const message =
          error instanceof Error ? error.message : "unknown file read error";
        lastOAuthUi.notify(
          `Failed to read MCP OAuth state file ${MCP_AUTH_STATE_PATH}: ${message}`,
          "warning",
        );
      }
      return;
    }

    let parsedRawState: unknown;
    try {
      parsedRawState = JSON.parse(rawAuthState);
    } catch (error) {
      if (lastOAuthUi !== null) {
        const message =
          error instanceof Error ? error.message : "unknown JSON parse error";
        lastOAuthUi.notify(
          `Failed to parse MCP OAuth state file ${MCP_AUTH_STATE_PATH}: ${message}`,
          "warning",
        );
      }
      return;
    }

    const parsedState = parsePersistedMcpOAuthFile(parsedRawState);

    persistedAuthByServer.clear();
    for (const [serverKey, state] of Object.entries(parsedState.servers)) {
      persistedAuthByServer.set(serverKey, state);
    }
  };

  const hydrateRuntimeAuthState = (runtime: McpRuntime) => {
    if (runtime.definition.type !== "remote" || runtime.oauthState === null) {
      return;
    }

    const persisted = persistedAuthByServer.get(runtime.definition.key);
    if (persisted === undefined) {
      return;
    }

    if (persisted.url !== runtime.definition.url) {
      persistedAuthByServer.delete(runtime.definition.key);
      queuePersistedAuthWrite();
      return;
    }

    runtime.oauthState.clientInformation = persisted.clientInformation;
    runtime.oauthState.tokens = persisted.tokens;
  };

  const queuePersistedDiscoveryWrite = () => {
    const serialized: PersistedMcpDiscoveryFile = {
      servers: Object.fromEntries(persistedDiscoveryByServer.entries()),
    };

    discoveryCacheWriteQueue = discoveryCacheWriteQueue
      .catch(() => {
        // keep queue alive after previous failure
      })
      .then(async () => {
        try {
          await mkdir(dirname(MCP_DISCOVERY_CACHE_PATH), { recursive: true });
          await writeFile(
            MCP_DISCOVERY_CACHE_PATH,
            `${JSON.stringify(serialized, null, 2)}\n`,
            {
              encoding: "utf8",
              mode: 0o600,
            },
          );
          await chmod(MCP_DISCOVERY_CACHE_PATH, 0o600);
        } catch (error) {
          if (lastOAuthUi !== null) {
            const message =
              error instanceof Error ? error.message : "unknown file write error";
            lastOAuthUi.notify(
              `Failed to persist MCP discovery cache: ${message}`,
              "warning",
            );
          }
        }
      });
  };

  const persistDiscoveredTools = (
    definition: McpServerDefinition,
    tools: readonly McpRegisteredTool[],
  ) => {
    discoveredToolsByServer.set(definition.key, tools);
    discoverySourceByServer.set(definition.key, "discovered");
    persistedDiscoveryByServer.set(definition.key, {
      definitionHash: computeDefinitionHash(definition),
      updatedAt: new Date().toISOString(),
      tools: tools.map((tool) => ({
        mcpToolName: tool.mcpToolName,
        piToolName: tool.piToolName,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
    queuePersistedDiscoveryWrite();
  };

  const invalidateDiscoveredTools = (serverKey: string) => {
    const clearedPersistedState = persistedDiscoveryByServer.delete(serverKey);
    const clearedInMemoryState = discoveredToolsByServer.delete(serverKey);
    discoverySourceByServer.delete(serverKey);

    if (clearedPersistedState || clearedInMemoryState) {
      queuePersistedDiscoveryWrite();
    }
  };

  const ensureDiscoveryCacheLoaded = async (oauthUi: OAuthUi | null): Promise<void> => {
    if (discoveryCacheLoaded) {
      if (oauthUi !== null) {
        lastOAuthUi = oauthUi;
      }
      return;
    }
    discoveryCacheLoaded = true;

    if (oauthUi !== null) {
      lastOAuthUi = oauthUi;
    }

    let rawDiscoveryState: string;
    try {
      rawDiscoveryState = await readFile(MCP_DISCOVERY_CACHE_PATH, "utf8");
    } catch (error) {
      const isMissingDiscoveryFile =
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT";

      if (isMissingDiscoveryFile) {
        return;
      }

      if (lastOAuthUi !== null) {
        const message =
          error instanceof Error ? error.message : "unknown file read error";
        lastOAuthUi.notify(
          `Failed to read MCP discovery cache ${MCP_DISCOVERY_CACHE_PATH}: ${message}`,
          "warning",
        );
      }
      return;
    }

    let parsedRawState: unknown;
    try {
      parsedRawState = JSON.parse(rawDiscoveryState);
    } catch (error) {
      if (lastOAuthUi !== null) {
        const message =
          error instanceof Error ? error.message : "unknown JSON parse error";
        lastOAuthUi.notify(
          `Failed to parse MCP discovery cache ${MCP_DISCOVERY_CACHE_PATH}: ${message}`,
          "warning",
        );
      }
      return;
    }

    const parsedState = parsePersistedMcpDiscoveryFile(parsedRawState);

    persistedDiscoveryByServer.clear();
    for (const [serverKey, state] of Object.entries(parsedState.servers)) {
      persistedDiscoveryByServer.set(serverKey, state);
    }
  };

  const hydrateDiscoveredToolsFromCache = (definition: McpServerDefinition) => {
    const persisted = persistedDiscoveryByServer.get(definition.key);
    if (persisted === undefined) {
      return;
    }

    if (
      persisted.definitionHash !== computeDefinitionHash(definition) ||
      !isPersistedDiscoveryStateFresh(persisted)
    ) {
      persistedDiscoveryByServer.delete(definition.key);
      discoverySourceByServer.delete(definition.key);
      queuePersistedDiscoveryWrite();
      return;
    }

    discoveredToolsByServer.set(
      definition.key,
      hydrateRegisteredTools(definition, persisted.tools),
    );
    discoverySourceByServer.set(definition.key, "cached");
  };

  const persistSessionServerSelection = () => {
    pi.appendEntry<McpSessionState>(MCP_SESSION_CONFIG_TYPE, {
      enabledServers: Array.from(sessionEnabledServers).sort((a, b) =>
        a.localeCompare(b),
      ),
    });
  };

  const restoreSessionServerSelectionFromBranch = async (ctx: ExtensionContext) => {
    let savedEnabledServers: readonly string[] | undefined;

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== MCP_SESSION_CONFIG_TYPE) {
        continue;
      }

      const data = entry.data;
      if (!isRecord(data) || !Array.isArray(data.enabledServers)) {
        continue;
      }

      const parsedEnabledServers = data.enabledServers.filter(
        (value): value is string => typeof value === "string",
      );
      savedEnabledServers = parsedEnabledServers;
    }

    const restoredEnabledServers = new Set<string>();
    const source = savedEnabledServers ?? Array.from(defaultEnabledServers);

    for (const serverKey of source) {
      if (configuredDefinitionsByKey.has(serverKey)) {
        restoredEnabledServers.add(serverKey);
      }
    }

    sessionEnabledServers = restoredEnabledServers;
  };

  const openAuthorizationUrlInBrowser = async (url: string): Promise<boolean> => {
    const attempts: ReadonlyArray<{
      readonly command: string;
      readonly args: readonly string[];
    }> =
      process.platform === "darwin"
        ? [{ command: "open", args: [url] }]
        : process.platform === "win32"
          ? [{ command: "cmd", args: ["/c", "start", "", url] }]
          : [{ command: "xdg-open", args: [url] }];

    for (const attempt of attempts) {
      try {
        const result = await pi.exec(attempt.command, [...attempt.args], {
          timeout: 5_000,
        });
        if (result.code === 0) {
          return true;
        }
      } catch {
        // continue to next opener
      }
    }

    return false;
  };

  const createAuthorizationCodeRequester = (
    oauthUi: OAuthUi | null,
  ): ((serverKey: string, authorizationUrl: URL) => Promise<string>) | null => {
    if (oauthUi === null) {
      return null;
    }

    return async (serverKey: string, authorizationUrl: URL): Promise<string> => {
      const authorizationUrlString = authorizationUrl.toString();
      oauthUi.notify(
        `OAuth required for MCP server ${serverKey}. Authorize at: ${authorizationUrlString}`,
        "info",
      );

      const callbackCapturePromise = waitForOAuthCallbackCode(
        serverKey,
        OAUTH_CALLBACK_WAIT_TIMEOUT_MS,
      );

      const opened = await openAuthorizationUrlInBrowser(authorizationUrlString);
      if (!opened) {
        oauthUi.notify(
          "Could not open your browser automatically. Open the authorization URL manually.",
          "warning",
        );
      }

      const callbackCapture = await callbackCapturePromise;
      if (callbackCapture.status === "code") {
        oauthUi.notify(`OAuth callback received for ${serverKey}.`, "info");
        return callbackCapture.code;
      }

      if (callbackCapture.status === "error") {
        throw new Error(callbackCapture.message);
      }

      if (callbackCapture.status === "unavailable") {
        oauthUi.notify(
          `Automatic OAuth callback capture is unavailable for ${serverKey}: ${callbackCapture.message}`,
          "warning",
        );
      } else {
        oauthUi.notify(
          `No OAuth callback received for ${serverKey} after waiting ${Math.round(OAUTH_CALLBACK_WAIT_TIMEOUT_MS / 1000)} seconds.`,
          "warning",
        );
      }

      const input = await oauthUi.input(
        `OAuth code for ${serverKey}`,
        "Paste the authorization code or callback URL",
      );

      if (!isNonEmptyString(input)) {
        throw new Error(
          `OAuth authorization was cancelled for MCP server ${serverKey}.`,
        );
      }

      const parsedCode = parseAuthorizationCodeInput(input);
      if (!isNonEmptyString(parsedCode)) {
        throw new Error(
          `No authorization code found for MCP server ${serverKey}. Paste the code or the full callback URL containing ?code=...`,
        );
      }

      return parsedCode;
    };
  };

  const getOrCreateRuntime = (definition: McpServerDefinition): McpRuntime => {
    const existingRuntime = runtimes.get(definition.key);
    if (existingRuntime !== undefined) {
      return existingRuntime;
    }

    const runtime = createRuntime(definition);
    hydrateRuntimeAuthState(runtime);
    runtimes.set(definition.key, runtime);
    return runtime;
  };

  const withConnectedClient = async <T>(
    definition: McpServerDefinition,
    requestAuthorizationCode: ((serverKey: string, authorizationUrl: URL) => Promise<string>) | null,
    operation: (runtime: McpRuntime, client: Client) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    const runtime = getOrCreateRuntime(definition);
    const connectionTimeoutMs =
      requestAuthorizationCode === null
        ? getRequestTimeoutMs(definition)
        : Math.max(getRequestTimeoutMs(definition), INTERACTIVE_AUTH_TIMEOUT_MS);

    try {
      return await withRuntimeLease(runtime, async () => {
        const client = await withTimeout(
          ensureConnected(
            runtime,
            requestAuthorizationCode,
            updatePersistedAuthFromRuntime,
            invalidateDiscoveredTools,
          ),
          connectionTimeoutMs,
          `Connecting to MCP server ${definition.key}`,
          signal,
        );
        clearConnectionFailure(definition.key);

        return await operation(runtime, client);
      });
    } catch (error) {
      if (signal?.aborted === true) {
        await closeRuntime(runtime);
      }
      if (runtime.client === null || isAuthRequiredFailure(error, getErrorMessage(error))) {
        recordConnectionFailure(definition.key, error);
      }
      throw error;
    }
  };

  const ensureServerMetadata = async (
    definition: McpServerDefinition,
    requestAuthorizationCode: ((serverKey: string, authorizationUrl: URL) => Promise<string>) | null,
    forceRefresh = false,
    signal?: AbortSignal,
  ): Promise<readonly McpRegisteredTool[]> => {
    if (!forceRefresh) {
      const existingMetadata = discoveredToolsByServer.get(definition.key);
      if (existingMetadata !== undefined) {
        return existingMetadata;
      }
    }

    const hadRuntime = runtimes.has(definition.key);
    const runtime = getOrCreateRuntime(definition);

    try {
      const registeredTools = await withConnectedClient(
        definition,
        requestAuthorizationCode,
        async (_runtime, client) => {
          const tools = await withTimeout(
            listAllTools(client, getRequestTimeoutMs(definition), signal),
            getRequestTimeoutMs(definition),
            `Listing tools from MCP server ${definition.key}`,
            signal,
          );

          return createRegisteredTools(definition, tools);
        },
        signal,
      );

      persistDiscoveredTools(definition, registeredTools);
      return registeredTools;
    } catch (error) {
      if (!hadRuntime) {
        await closeRuntime(runtime);
        runtimes.delete(definition.key);
      }
      throw error;
    }
  };

  const invokeMcpTool = async (
    runtime: McpRuntime,
    registeredTool: McpRegisteredTool,
    params: Record<string, unknown>,
    toolOauthUi: OAuthUi | null,
    signal?: AbortSignal,
  ) => {
    const requestToolAuthorizationCode = createAuthorizationCodeRequester(toolOauthUi);

    const callResult = await (async () => {
      try {
        return await withRuntimeLease(runtime, async () => {
          const connectionTimeoutMs =
            requestToolAuthorizationCode === null
              ? getRequestTimeoutMs(runtime.definition)
              : Math.max(getRequestTimeoutMs(runtime.definition), INTERACTIVE_AUTH_TIMEOUT_MS);
          let client = await withTimeout(
            ensureConnected(
              runtime,
              requestToolAuthorizationCode,
              updatePersistedAuthFromRuntime,
              invalidateDiscoveredTools,
            ),
            connectionTimeoutMs,
            `Connecting to MCP server ${runtime.definition.key}`,
            signal,
          );

          const requestOptions = { timeout: getRequestTimeoutMs(runtime.definition), signal };

          try {
            return await client.callTool(
              {
                name: registeredTool.mcpToolName,
                arguments: params,
              },
              undefined,
              requestOptions,
            );
          } catch (error) {
            if (error instanceof UnauthorizedError) {
              await closeRuntime(runtime);
              client = await withTimeout(
                ensureConnected(
                  runtime,
                  requestToolAuthorizationCode,
                  updatePersistedAuthFromRuntime,
                  invalidateDiscoveredTools,
                ),
                connectionTimeoutMs,
                `Reconnecting to MCP server ${runtime.definition.key}`,
                signal,
              );
              return await client.callTool(
                {
                  name: registeredTool.mcpToolName,
                  arguments: params,
                },
                undefined,
                requestOptions,
              );
            }

            throw error;
          }
        });
      } catch (error) {
        if (signal?.aborted === true) {
          await closeRuntime(runtime);
        }
        throw error;
      }
    })();

    const content = isRecord(callResult) ? callResult.content : undefined;
    const isError =
      isRecord(callResult) && typeof callResult.isError === "boolean"
        ? callResult.isError
        : false;
    const output =
      registeredTool.outputMode === "muted"
        ? { text: "", truncated: false, fullOutputPath: null }
        : await truncateContent(formatToolContent(content));
    const structuredContent =
      registeredTool.outputMode !== "muted" &&
      isRecord(callResult) &&
      isRecord(callResult.structuredContent)
        ? callResult.structuredContent
        : null;

    return {
      output,
      isError,
      structuredContent,
    };
  };

  const ensureToolsForServer = async (
    serverKey: string,
    requestAuthorizationCode: ((serverKey: string, authorizationUrl: URL) => Promise<string>) | null,
    forceRefresh = false,
    signal?: AbortSignal,
  ): Promise<readonly McpRegisteredTool[]> => {
    const definition = configuredDefinitionsByKey.get(serverKey);
    if (definition === undefined) {
      throw new Error(`Unknown MCP server: ${serverKey}`);
    }

    if (!isServerEnabledForSession(serverKey)) {
      throw new Error(
        `MCP server ${serverKey} is disabled in this session. Use /mcp to enable it.`,
      );
    }

    return await ensureServerMetadata(definition, requestAuthorizationCode, forceRefresh, signal);
  };

  const inferServerKeyFromToolReference = (toolReference: string): string | null => {
    const sortedServerKeys = Array.from(configuredDefinitionsByKey.keys()).sort(
      (left, right) => right.length - left.length,
    );

    for (const serverKey of sortedServerKeys) {
      if (toolReference === serverKey || toolReference.startsWith(`${serverKey}_`)) {
        return serverKey;
      }
    }

    return null;
  };

  const resolveToolReference = (
    toolReference: string,
    serverKey?: string,
  ):
    | {
        readonly definition: McpServerDefinition;
        readonly tool: McpRegisteredTool;
      }
    | null => {
    const trimmedReference = toolReference.trim();
    if (trimmedReference.length === 0) {
      return null;
    }

    const candidateServerKeys =
      isNonEmptyString(serverKey) && isServerEnabledForSession(serverKey)
        ? [serverKey]
        : (() => {
            const inferredServerKey = inferServerKeyFromToolReference(trimmedReference);
            return inferredServerKey === null
              ? Array.from(sessionEnabledServers)
              : [inferredServerKey];
          })();

    for (const candidateServerKey of candidateServerKeys) {
      const definition = configuredDefinitionsByKey.get(candidateServerKey);
      const tools = discoveredToolsByServer.get(candidateServerKey);
      if (definition === undefined || tools === undefined) {
        continue;
      }

      const matchedTool = tools.find(
        (tool) =>
          tool.piToolName === trimmedReference || tool.mcpToolName === trimmedReference,
      );
      if (matchedTool !== undefined) {
        return {
          definition,
          tool: matchedTool,
        };
      }
    }

    return null;
  };

  const isServerEnabledForSession = (serverKey: string): boolean =>
    sessionEnabledServers.has(serverKey);

  const getSearchScopeServerKeys = (serverKey?: string): readonly string[] =>
    serverKey === undefined
      ? Array.from(sessionEnabledServers).sort((left, right) => left.localeCompare(right))
      : isServerEnabledForSession(serverKey)
        ? [serverKey]
        : [];

  const hasUndiscoveredSearchScope = (serverKey?: string): boolean =>
    getSearchScopeServerKeys(serverKey).some(
      (candidateServerKey) => !discoveredToolsByServer.has(candidateServerKey),
    );

  const findToolMatches = (
    query: string,
    serverKey: string | undefined,
    regex: boolean,
  ) =>
    findDiscoveredToolMatches(discoveredToolsByServer, query, {
      regex,
      serverKey,
    });

  const refreshDiscoveryScopeBestEffort = async (serverKey?: string, signal?: AbortSignal): Promise<void> => {
    const refreshes = getSearchScopeServerKeys(serverKey)
      .filter((candidateServerKey) => !discoveredToolsByServer.has(candidateServerKey))
      .map(async (candidateServerKey) => {
        const definition = configuredDefinitionsByKey.get(candidateServerKey);
        if (definition === undefined) {
          return;
        }

        try {
          await ensureServerMetadata(definition, null, false, signal);
        } catch {
          // best-effort warm-up only; explicit refresh still surfaces failures
        }
      });

    await Promise.allSettled(refreshes);
  };

  const hasAuthorizationHeader = (definition: McpServerDefinition): boolean => {
    if (definition.type !== "remote") {
      return false;
    }

    return Object.keys(definition.headers).some(
      (headerName) => headerName.trim().toLowerCase() === "authorization",
    );
  };

  const getRuntimeConnectionStatus = (serverKey: string): McpCommandConnectionStatus => {
    const runtime = runtimes.get(serverKey);
    if (runtime !== undefined && runtime.client !== null) {
      return "connected";
    }

    if (runtime !== undefined && runtime.connectPromise !== null) {
      return "connecting";
    }

    return connectionFailuresByServer.has(serverKey) ? "failure" : "idle";
  };

  const getAuthStatus = (definition: McpServerDefinition): string => {
    if (definition.type !== "remote") {
      return "n/a";
    }

    const runtime = runtimes.get(definition.key);
    const pendingAuthorizationUrl = runtime?.oauthState?.pendingAuthorizationUrl;
    const failure = connectionFailuresByServer.get(definition.key);
    if (
      failure?.authRequired === true ||
      (pendingAuthorizationUrl !== null && pendingAuthorizationUrl !== undefined)
    ) {
      return "auth required";
    }

    if (hasAuthorizationHeader(definition)) {
      return "authorization header configured";
    }

    const persistedAuth = persistedAuthByServer.get(definition.key);
    const freshPersistedAuth =
      persistedAuth !== undefined && persistedAuth.url === definition.url
        ? persistedAuth
        : undefined;

    if (runtime?.oauthState?.tokens !== undefined || freshPersistedAuth?.tokens !== undefined) {
      return "oauth token cached";
    }

    if (
      runtime?.oauthState?.clientInformation !== undefined ||
      freshPersistedAuth?.clientInformation !== undefined
    ) {
      return "oauth client registered";
    }

    return "none/unknown";
  };

  const getDiscoveredToolCount = (serverKey: string): number =>
    discoverySourceByServer.get(serverKey) === "discovered"
      ? discoveredToolsByServer.get(serverKey)?.length ?? 0
      : 0;

  const getServerStatuses = (): readonly McpCommandServerStatus[] =>
    Array.from(configuredDefinitionsByKey.values())
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((definition) => {
        const cachedToolCount = persistedDiscoveryByServer.get(definition.key)?.tools.length ?? 0;
        const failure = connectionFailuresByServer.get(definition.key);
        return {
          serverKey: definition.key,
          serverType: definition.type,
          configuredEnabled: definition.enabled,
          sessionEnabled: isServerEnabledForSession(definition.key),
          transport: definition.type === "remote" ? definition.transport : null,
          cachedToolCount,
          discoveredToolCount: getDiscoveredToolCount(definition.key),
          connectionStatus: getRuntimeConnectionStatus(definition.key),
          authStatus: getAuthStatus(definition),
          lastFailureMessage: failure?.message ?? null,
        };
      });

  const getCommandToolSource = (serverKey: string): McpCommandToolSource =>
    discoverySourceByServer.get(serverKey) ?? "none";

  const getServerTools = (serverKey: string | null): McpCommandToolsResult => {
    if (serverKey !== null && !configuredDefinitionsByKey.has(serverKey)) {
      return {
        status: "unknown_server",
        serverKey,
      };
    }

    const definitions = Array.from(configuredDefinitionsByKey.values())
      .filter((definition) => serverKey === null || definition.key === serverKey)
      .sort((left, right) => left.key.localeCompare(right.key));

    const serverTools: McpCommandServerTools[] = definitions.map((definition) => ({
      serverKey: definition.key,
      source: getCommandToolSource(definition.key),
      cachedToolCount: persistedDiscoveryByServer.get(definition.key)?.tools.length ?? 0,
      discoveredToolCount: getDiscoveredToolCount(definition.key),
      tools: discoveredToolsByServer.get(definition.key) ?? [],
    }));

    return {
      status: "ok",
      serverTools,
    };
  };

  const reconnectServer = async (
    serverKey: string,
    oauthUi: OAuthUi | null,
  ): Promise<McpCommandReconnectResult> => {
    const definition = configuredDefinitionsByKey.get(serverKey);
    if (definition === undefined) {
      return {
        status: "unknown_server",
        serverKey,
      };
    }

    const existingRuntime = runtimes.get(serverKey);
    const closedRuntime = existingRuntime !== undefined;
    if (existingRuntime !== undefined) {
      await closeRuntime(existingRuntime);
      runtimes.delete(serverKey);
    }

    const requestAuthorizationCode = createAuthorizationCodeRequester(oauthUi);
    try {
      const tools = await ensureServerMetadata(definition, requestAuthorizationCode, true);
      clearConnectionFailure(serverKey);
      return {
        status: "ok",
        serverKey,
        closedRuntime,
        toolCount: tools.length,
      };
    } catch (error) {
      recordConnectionFailure(serverKey, error);
      return {
        status: "failed",
        serverKey,
        closedRuntime,
        message: getErrorMessage(error),
      };
    }
  };

  const initializeFromConfig = (oauthUi: OAuthUi | null): Promise<void> => {
    if (oauthUi !== null) {
      lastOAuthUi = oauthUi;
    }

    if (initializationPromise !== null) {
      return initializationPromise;
    }

    if (initialized) {
      return Promise.resolve();
    }

    initializationPromise = (async () => {
      await ensureAuthStateLoaded(oauthUi);
      await ensureDiscoveryCacheLoaded(oauthUi);

      const config = await loadMcpConfig();

      configuredDefinitionsByKey.clear();
      discoveredToolsByServer.clear();
      discoverySourceByServer.clear();
      connectionFailuresByServer.clear();
      for (const definition of config.definitions) {
        configuredDefinitionsByKey.set(definition.key, definition);
        hydrateDiscoveredToolsFromCache(definition);
      }

      const enabledDefinitions = config.definitions.filter((definition) => definition.enabled);
      defaultEnabledServers = new Set(enabledDefinitions.map((definition) => definition.key));
      sessionEnabledServers = new Set(defaultEnabledServers);

      registerDirectMcpTools(pi, {
        definitions: config.definitions,
        discoveredToolsByServer,
        services: {
          initializeFromConfig,
          getOrCreateRuntime,
          invokeMcpTool,
        },
        warn: warnMcpDirectToolRegistration,
      });

      initialized = true;
    })().finally(() => {
      initializationPromise = null;
    });

    return initializationPromise;
  };


  registerMcpGatewayTool(pi, {
    initializeFromConfig,
    getConfiguredDefinitions: () => configuredDefinitionsByKey,
    getSessionEnabledServers: () => sessionEnabledServers,
    createAuthorizationCodeRequester,
    inferServerKeyFromToolReference,
    ensureToolsForServer,
    hasDiscoveredTools: (serverKey: string) => discoveredToolsByServer.has(serverKey),
    resolveToolReference,
    getOrCreateRuntime,
    invokeMcpTool,
    isServerEnabledForSession,
    withConnectedClient,
    getSearchScopeServerKeys,
    ensureServerMetadata,
    findToolMatches,
    hasUndiscoveredSearchScope,
    refreshDiscoveryScopeBestEffort,
  });

  registerMcpCommand(pi, {
    initializeFromConfig,
    getConfiguredDefinitions: () => configuredDefinitionsByKey,
    getSessionEnabledServers: () => sessionEnabledServers,
    setSessionEnabledServers: (enabledServers: Set<string>) => {
      sessionEnabledServers = enabledServers;
    },
    persistSessionServerSelection,
    getServerStatuses,
    getServerTools,
    reconnectServer,
  });

  pi.on("session_start", (_event, ctx) => {
    const oauthUi: OAuthUi | null =
      ctx.hasUI
        ? {
            notify: ctx.ui.notify.bind(ctx.ui),
            input: ctx.ui.input.bind(ctx.ui),
          }
        : null;

    return initializeFromConfig(oauthUi)
      .then(() => {
        return restoreSessionServerSelectionFromBranch(ctx);
      })
      .catch((error) => {
        if (oauthUi === null) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        oauthUi.notify(`MCP startup failed: ${message}`, "warning");
      });
  });

  pi.on("session_tree", async (_event, ctx) => {
    await restoreSessionServerSelectionFromBranch(ctx);
  });

  pi.on("session_shutdown", async () => {
    const closures = Array.from(runtimes.values()).map(closeRuntime);
    await Promise.all(closures);

    await authStateWriteQueue;
    await discoveryCacheWriteQueue;

    runtimes.clear();
    discoveredToolsByServer.clear();
    discoverySourceByServer.clear();
    connectionFailuresByServer.clear();
    configuredDefinitionsByKey.clear();
    defaultEnabledServers.clear();
    sessionEnabledServers.clear();
    persistedAuthByServer.clear();
    persistedDiscoveryByServer.clear();
    authStateLoaded = false;
    discoveryCacheLoaded = false;
    lastOAuthUi = null;
  });
}
