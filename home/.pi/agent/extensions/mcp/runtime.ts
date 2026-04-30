import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { IDLE_CONNECTION_TIMEOUT_MS, OAUTH_CALLBACK_BASE_URL } from "./constants.js";
import type { JsonRecord, McpRemoteTransport, McpRuntime, McpServerDefinition } from "./types.js";
import { createOAuthProvider } from "./oauth.js";
import { createTransport, shouldFallbackToSse } from "./transport.js";
import { isNonEmptyString, isRecord, parseAuthorizationCodeInput } from "./utils.js";

export const createRuntime = (definition: McpServerDefinition): McpRuntime => ({
  definition,
  client: null,
  transport: null,
  connectPromise: null,
  oauthState:
    definition.type === "remote"
      ? {
          redirectUrl: `${OAUTH_CALLBACK_BASE_URL}/${encodeURIComponent(definition.key)}`,
          clientInformation: undefined,
          tokens: undefined,
          codeVerifier: undefined,
          discoveryState: undefined,
          pendingAuthorizationUrl: null,
        }
      : null,
  lastActivityAt: 0,
  activeRequestCount: 0,
  idleCloseTimer: null,
  idleCloseGeneration: 0,
  closeGeneration: 0,
});

const createRequestOptions = (
  timeoutMs?: number,
  signal?: AbortSignal,
):
  | {
      readonly timeout?: number;
      readonly signal?: AbortSignal;
    }
  | undefined => {
  if (timeoutMs === undefined && signal === undefined) {
    return undefined;
  }

  return {
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    ...(signal === undefined ? {} : { signal }),
  };
};

export const createRuntimeClient = (
  runtime: McpRuntime,
  onToolListChanged: (serverKey: string) => void,
): Client =>
  new Client(
    {
      name: `pi-mcp-${runtime.definition.key}`,
      version: "1.0.0",
    },
    runtime.definition.type === "remote"
      ? {
          listChanged: {
            tools: {
              autoRefresh: false,
              onChanged: (error) => {
                if (error === null) {
                  onToolListChanged(runtime.definition.key);
                }
              },
            },
          },
        }
      : undefined,
  );

export const ensureConnected = async (
  runtime: McpRuntime,
  requestAuthorizationCode: ((serverKey: string, authorizationUrl: URL) => Promise<string>) | null,
  onOAuthStateChange: (runtime: McpRuntime) => void,
  onToolListChanged: (serverKey: string) => void,
): Promise<Client> => {
  if (runtime.client !== null) {
    return runtime.client;
  }

  if (runtime.connectPromise !== null) {
    return runtime.connectPromise;
  }

  runtime.connectPromise = (async () => {
    const connectionGeneration = runtime.closeGeneration;
    const assertConnectionCurrent = () => {
      if (runtime.closeGeneration !== connectionGeneration) {
        throw new Error(
          `Connection to MCP server ${runtime.definition.key} was closed before it completed.`,
        );
      }
    };

    const connectWithTransport = async (
      transportPreference: Exclude<McpRemoteTransport, "auto">,
    ): Promise<{
      readonly client: Client;
      readonly transport:
        | StreamableHTTPClientTransport
        | SSEClientTransport
        | StdioClientTransport;
    }> => {
      const client = createRuntimeClient(runtime, onToolListChanged);
      const oauthProvider = createOAuthProvider(runtime, onOAuthStateChange);
      const initialTransport = createTransport(
        runtime.definition,
        oauthProvider,
        transportPreference,
      );
      runtime.transport = initialTransport;
      let connectedTransport:
        | StreamableHTTPClientTransport
        | SSEClientTransport
        | StdioClientTransport = initialTransport;

      try {
        await client.connect(initialTransport);
        assertConnectionCurrent();
      } catch (error) {
        if (error instanceof UnauthorizedError && runtime.oauthState !== null) {
          try {
            const authorizationUrl = runtime.oauthState.pendingAuthorizationUrl;
            runtime.oauthState.pendingAuthorizationUrl = null;

            if (authorizationUrl === null) {
              throw new Error(
                `OAuth authorization is required for MCP server ${runtime.definition.key}, but no authorization URL was provided by the server.`,
              );
            }

            if (requestAuthorizationCode === null) {
              throw new Error(
                `OAuth authorization is required for MCP server ${runtime.definition.key}. Run Pi interactively to complete sign-in. Authorization URL: ${authorizationUrl.toString()}`,
              );
            }

            const authorizationCode = await requestAuthorizationCode(
              runtime.definition.key,
              authorizationUrl,
            );
            assertConnectionCurrent();
            const parsedCode = parseAuthorizationCodeInput(authorizationCode);

            if (!isNonEmptyString(parsedCode)) {
              throw new Error(
                `No authorization code was provided for MCP server ${runtime.definition.key}.`,
              );
            }

            await initialTransport.finishAuth(parsedCode);
            assertConnectionCurrent();

            try {
              await initialTransport.close();
            } catch {
              // best-effort cleanup before reconnecting with fresh transport
            }
            if (runtime.transport === initialTransport) {
              runtime.transport = null;
            }

            assertConnectionCurrent();
            const authenticatedTransport = createTransport(
              runtime.definition,
              oauthProvider,
              transportPreference,
            );
            runtime.transport = authenticatedTransport;
            await client.connect(authenticatedTransport);
            assertConnectionCurrent();
            connectedTransport = authenticatedTransport;
          } catch (authError) {
            const activeTransport = runtime.transport;
            if (activeTransport !== null) {
              try {
                await activeTransport.close();
              } catch {
                // best-effort cleanup after failed authorization
              }
            }
            try {
              await client.close();
            } catch {
              // best-effort cleanup after failed authorization
            }
            if (runtime.transport === activeTransport) {
              runtime.transport = null;
            }
            throw authError;
          }
        } else {
          try {
            await initialTransport.close();
          } catch {
            // best-effort cleanup after failed connection
          }
          try {
            await client.close();
          } catch {
            // best-effort cleanup after failed connection
          }
          if (runtime.transport === initialTransport) {
            runtime.transport = null;
          }
          throw error;
        }
      }

      return {
        client,
        transport: connectedTransport,
      };
    };

    if (runtime.definition.type === "remote") {
      const transportPreferences: readonly Exclude<McpRemoteTransport, "auto">[] =
        runtime.definition.transport === "auto"
          ? ["streamable-http", "sse"]
          : [runtime.definition.transport];

      let lastError: unknown = null;
      for (const transportPreference of transportPreferences) {
        try {
          const connection = await connectWithTransport(transportPreference);
          assertConnectionCurrent();
          connection.client.onclose = () => {
            runtime.client = null;
            runtime.transport = null;
            clearIdleCloseTimer(runtime);
          };

          runtime.client = connection.client;
          runtime.transport = connection.transport;
          return connection.client;
        } catch (error) {
          lastError = error;
          if (
            runtime.definition.transport !== "auto" ||
            transportPreference !== "streamable-http" ||
            !shouldFallbackToSse(error)
          ) {
            throw error;
          }
        }
      }

      throw (lastError instanceof Error
        ? lastError
        : new Error(`Failed to connect to MCP server ${runtime.definition.key}.`));
    }

    const client = createRuntimeClient(runtime, onToolListChanged);
    const transport = createTransport(runtime.definition, null);
    runtime.transport = transport;
    await client.connect(transport);
    assertConnectionCurrent();

    client.onclose = () => {
      runtime.client = null;
      runtime.transport = null;
      clearIdleCloseTimer(runtime);
    };

    runtime.client = client;
    runtime.transport = transport;
    return client;
  })();

  try {
    return await runtime.connectPromise;
  } finally {
    runtime.connectPromise = null;
  }
};

export const listAllTools = async (
  client: Client,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<
  readonly {
    readonly name: string;
    readonly description: string | null;
    readonly inputSchema: JsonRecord;
  }[]
> => {
  const tools: {
    name: string;
    description: string | null;
    inputSchema: JsonRecord;
  }[] = [];

  let cursor: string | undefined;
  do {
    const page = await client.listTools(
      { cursor },
      createRequestOptions(timeoutMs, signal),
    );
    for (const tool of page.tools) {
      tools.push({
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : null,
        inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : { type: "object" },
      });
    }
    cursor = page.nextCursor;
  } while (typeof cursor === "string" && cursor.length > 0);

  return tools;
};

export const listAllPrompts = async (
  client: Client,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<
  readonly {
    readonly name: string;
    readonly description: string | null;
    readonly argumentsSummary: string | null;
  }[]
> => {
  const prompts: {
    name: string;
    description: string | null;
    argumentsSummary: string | null;
  }[] = [];

  let cursor: string | undefined;
  do {
    const page = await client.listPrompts(
      { cursor },
      createRequestOptions(timeoutMs, signal),
    );
    for (const prompt of page.prompts) {
      const argumentSummary = Array.isArray(prompt.arguments)
        ? prompt.arguments
            .map((argument) => {
              const required = argument.required === true ? "required" : "optional";
              return `${argument.name} (${required})`;
            })
            .join(", ")
        : null;

      prompts.push({
        name: prompt.name,
        description: typeof prompt.description === "string" ? prompt.description : null,
        argumentsSummary:
          argumentSummary !== null && argumentSummary.trim().length > 0
            ? argumentSummary
            : null,
      });
    }
    cursor = page.nextCursor;
  } while (typeof cursor === "string" && cursor.length > 0);

  return prompts;
};

export const listAllResources = async (
  client: Client,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<
  readonly {
    readonly name: string;
    readonly uri: string;
    readonly description: string | null;
    readonly mimeType: string | null;
  }[]
> => {
  const resources: {
    name: string;
    uri: string;
    description: string | null;
    mimeType: string | null;
  }[] = [];

  let cursor: string | undefined;
  do {
    const page = await client.listResources(
      { cursor },
      createRequestOptions(timeoutMs, signal),
    );
    for (const resource of page.resources) {
      resources.push({
        name: resource.name,
        uri: resource.uri,
        description:
          typeof resource.description === "string" ? resource.description : null,
        mimeType: typeof resource.mimeType === "string" ? resource.mimeType : null,
      });
    }
    cursor = page.nextCursor;
  } while (typeof cursor === "string" && cursor.length > 0);

  return resources;
};

export const clearIdleCloseTimer = (runtime: McpRuntime) => {
  if (runtime.idleCloseTimer !== null) {
    clearTimeout(runtime.idleCloseTimer);
    runtime.idleCloseTimer = null;
  }
};

export const touchRuntime = (runtime: McpRuntime) => {
  runtime.lastActivityAt = Date.now();
  runtime.idleCloseGeneration += 1;
  clearIdleCloseTimer(runtime);
};

export const closeRuntime = async (runtime: McpRuntime): Promise<void> => {
  const client = runtime.client;
  const transport = runtime.transport;
  const connectPromise = runtime.connectPromise;
  runtime.client = null;
  runtime.transport = null;
  runtime.connectPromise = null;
  runtime.closeGeneration += 1;
  clearIdleCloseTimer(runtime);

  if (client !== null) {
    try {
      await client.close();
    } catch {
      // best-effort cleanup
    }
  } else if (transport !== null) {
    try {
      await transport.close();
    } catch {
      // best-effort cleanup
    }
  }

  if (connectPromise !== null) {
    try {
      const connectedClient = await connectPromise;
      const connectedTransport = runtime.transport;
      runtime.client = null;
      runtime.transport = null;
      if (connectedClient !== client) {
        await connectedClient.close();
      } else if (connectedTransport !== null && connectedTransport !== transport) {
        await connectedTransport.close();
      }
    } catch {
      // best-effort cleanup for in-flight connection
    }
  }
};

export const scheduleIdleClose = (runtime: McpRuntime) => {
  clearIdleCloseTimer(runtime);

  if (runtime.client === null || runtime.activeRequestCount > 0) {
    return;
  }

  const generation = runtime.idleCloseGeneration;
  const timer = setTimeout(() => {
    if (
      runtime.client === null ||
      runtime.activeRequestCount > 0 ||
      runtime.idleCloseGeneration !== generation
    ) {
      return;
    }

    void closeRuntime(runtime);
  }, IDLE_CONNECTION_TIMEOUT_MS);

  timer.unref?.();
  runtime.idleCloseTimer = timer;
};

export const withRuntimeLease = async <T>(
  runtime: McpRuntime,
  operation: () => Promise<T>,
): Promise<T> => {
  runtime.activeRequestCount += 1;
  touchRuntime(runtime);

  try {
    return await operation();
  } finally {
    runtime.activeRequestCount -= 1;
    runtime.lastActivityAt = Date.now();
    runtime.idleCloseGeneration += 1;

    if (runtime.activeRequestCount === 0) {
      scheduleIdleClose(runtime);
    }
  }
};
