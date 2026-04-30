import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CONNECTION_TIMEOUT_MS } from "./constants.js";
import type { McpRemoteTransport, McpServerDefinition } from "./types.js";

export const createRemoteRequestInit = (
  definition: Extract<McpServerDefinition, { readonly type: "remote" }>,
): RequestInit | undefined =>
  Object.keys(definition.headers).length === 0
    ? undefined
    : { headers: { ...definition.headers } };

export const createRemoteTransport = (
  definition: Extract<McpServerDefinition, { readonly type: "remote" }>,
  oauthProvider: OAuthClientProvider | null,
  transport: Exclude<McpRemoteTransport, "auto">,
): StreamableHTTPClientTransport | SSEClientTransport => {
  const requestInit = createRemoteRequestInit(definition);

  if (transport === "sse") {
    return new SSEClientTransport(new URL(definition.url), {
      authProvider: oauthProvider ?? undefined,
      requestInit,
    });
  }

  return new StreamableHTTPClientTransport(new URL(definition.url), {
    authProvider: oauthProvider ?? undefined,
    requestInit,
  });
};

export const createTransport = (
  definition: McpServerDefinition,
  oauthProvider: OAuthClientProvider | null,
  transport: Exclude<McpRemoteTransport, "auto"> = "streamable-http",
): StreamableHTTPClientTransport | SSEClientTransport | StdioClientTransport => {
  if (definition.type === "remote") {
    return createRemoteTransport(definition, oauthProvider, transport);
  }

  return new StdioClientTransport({
    command: definition.command,
    args: [...definition.args],
    env: { ...definition.env },
    cwd: definition.cwd ?? undefined,
  });
};

export const getRequestTimeoutMs = (definition: McpServerDefinition): number =>
  definition.type === "remote" ? definition.timeoutMs : CONNECTION_TIMEOUT_MS;

export const shouldFallbackToSse = (error: unknown): boolean => {
  if (!(error instanceof StreamableHTTPError)) {
    return false;
  }

  return (
    error.code === -1 ||
    error.code === 404 ||
    error.code === 405 ||
    error.code === 406 ||
    error.code === 415 ||
    error.code === 501
  );
};
