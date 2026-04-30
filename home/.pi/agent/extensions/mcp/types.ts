import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpToolOutputMode } from "./output-policy.js";

export type JsonRecord = Record<string, unknown>;
export type McpRemoteTransport = "auto" | "streamable-http" | "sse";

export type McpServerDefinition =
  | {
      readonly key: string;
      readonly type: "remote";
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly timeoutMs: number;
      readonly transport: McpRemoteTransport;
      readonly enabled: boolean;
      readonly outputMode: McpToolOutputMode;
      readonly outputModesByTool: Readonly<Record<string, McpToolOutputMode>>;
      readonly directTools: readonly string[];
    }
  | {
      readonly key: string;
      readonly type: "local";
      readonly command: string;
      readonly args: readonly string[];
      readonly env: Readonly<Record<string, string>>;
      readonly cwd: string | null;
      readonly enabled: boolean;
      readonly outputMode: McpToolOutputMode;
      readonly outputModesByTool: Readonly<Record<string, McpToolOutputMode>>;
      readonly directTools: readonly string[];
    };

export type McpRegisteredTool = {
  readonly mcpToolName: string;
  readonly piToolName: string;
  readonly description: string;
  readonly inputSchema: JsonRecord;
  readonly outputMode: McpToolOutputMode;
};

export type TruncateContentResult = {
  readonly text: string;
  readonly truncated: boolean;
  readonly fullOutputPath: string | null;
};

export type McpOAuthState = {
  readonly redirectUrl: string;
  clientInformation: OAuthClientInformationMixed | undefined;
  tokens: OAuthTokens | undefined;
  codeVerifier: string | undefined;
  discoveryState: OAuthDiscoveryState | undefined;
  pendingAuthorizationUrl: URL | null;
};

export type McpRuntime = {
  readonly definition: McpServerDefinition;
  client: Client | null;
  transport:
    | StreamableHTTPClientTransport
    | SSEClientTransport
    | StdioClientTransport
    | null;
  connectPromise: Promise<Client> | null;
  oauthState: McpOAuthState | null;
  lastActivityAt: number;
  activeRequestCount: number;
  idleCloseTimer: ReturnType<typeof setTimeout> | null;
  idleCloseGeneration: number;
  closeGeneration: number;
};

export type McpConfig = {
  readonly definitions: readonly McpServerDefinition[];
};

export type McpSessionState = {
  readonly enabledServers: readonly string[];
};

export type OAuthUi = {
  readonly notify: (message: string, level: "info" | "warning" | "error") => void;
  readonly input: (prompt: string, placeholder?: string) => Promise<string | undefined>;
};

export type OAuthCallbackCaptureResult =
  | { readonly status: "code"; readonly code: string }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "timeout" }
  | { readonly status: "unavailable"; readonly message: string };

export type PersistedMcpOAuthState = {
  readonly url: string;
  readonly updatedAt: string;
  readonly clientInformation?: OAuthClientInformationMixed;
  readonly tokens?: OAuthTokens;
};

export type PersistedMcpOAuthFile = {
  readonly servers: Readonly<Record<string, PersistedMcpOAuthState>>;
};

export type PersistedMcpDiscoveryTool = {
  readonly mcpToolName: string;
  readonly piToolName: string;
  readonly description: string;
  readonly inputSchema: JsonRecord;
};

export type PersistedMcpDiscoveryState = {
  readonly definitionHash: string;
  readonly updatedAt: string;
  readonly tools: readonly PersistedMcpDiscoveryTool[];
};

export type PersistedMcpDiscoveryFile = {
  readonly servers: Readonly<Record<string, PersistedMcpDiscoveryState>>;
};
