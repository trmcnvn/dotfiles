import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  OAuthClientInformationFullSchema,
  OAuthClientInformationSchema,
  OAuthTokensSchema,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  keyHint,
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const MCP_CONFIG_PATH =
  process.env.PI_MCP_CONFIG_PATH ?? join(homedir(), ".pi", "agent", "mcp.json");
const MCP_AUTH_STATE_PATH =
  process.env.PI_MCP_AUTH_PATH ?? join(homedir(), ".pi", "agent", "mcp-auth.json");
const CONNECTION_TIMEOUT_MS = 15_000;
const INTERACTIVE_AUTH_TIMEOUT_MS = 10 * 60_000;
const OAUTH_CALLBACK_WAIT_TIMEOUT_MS = 5 * 60_000;
const OAUTH_CALLBACK_BASE_URL = "http://127.0.0.1:54545/callback";
const MCP_COLLAPSED_PREVIEW_LINES = 14;

type JsonRecord = Record<string, unknown>;
type McpToolOutputMode = "full" | "collapsed" | "muted";

type McpServerDefinition =
  | {
      readonly key: string;
      readonly type: "remote";
      readonly url: string;
      readonly enabled: boolean;
      readonly outputMode: McpToolOutputMode;
      readonly outputModesByTool: Readonly<Record<string, McpToolOutputMode>>;
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
    };

type McpRegisteredTool = {
  readonly mcpToolName: string;
  readonly piToolName: string;
  readonly description: string;
  readonly outputMode: McpToolOutputMode;
};

type McpOAuthState = {
  readonly redirectUrl: string;
  clientInformation: OAuthClientInformationMixed | undefined;
  tokens: OAuthTokens | undefined;
  codeVerifier: string | undefined;
  discoveryState: OAuthDiscoveryState | undefined;
  pendingAuthorizationUrl: URL | null;
};

type McpRuntime = {
  readonly definition: McpServerDefinition;
  client: Client | null;
  transport: StreamableHTTPClientTransport | StdioClientTransport | null;
  connectPromise: Promise<Client> | null;
  readonly toolsByPiName: Map<string, McpRegisteredTool>;
  oauthState: McpOAuthState | null;
};

type DiscoveryFailure = {
  readonly key: string;
  readonly message: string;
};

type McpSessionState = {
  readonly enabledServers: readonly string[];
};

type OAuthUi = {
  readonly notify: (message: string, level: "info" | "warning" | "error") => void;
  readonly input: (prompt: string, placeholder?: string) => Promise<string | undefined>;
};

type OAuthCallbackCaptureResult =
  | { readonly status: "code"; readonly code: string }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "timeout" }
  | { readonly status: "unavailable"; readonly message: string };

type PersistedMcpOAuthState = {
  readonly url: string;
  readonly updatedAt: string;
  readonly clientInformation?: OAuthClientInformationMixed;
  readonly tokens?: OAuthTokens;
};

type PersistedMcpOAuthFile = {
  readonly servers: Readonly<Record<string, PersistedMcpOAuthState>>;
};

const OpenObjectParams = Type.Object({}, { additionalProperties: true });

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const parseOAuthClientInformation = (
  value: unknown,
): OAuthClientInformationMixed | undefined => {
  const full = OAuthClientInformationFullSchema.safeParse(value);
  if (full.success) {
    return full.data;
  }

  const basic = OAuthClientInformationSchema.safeParse(value);
  if (basic.success) {
    return basic.data;
  }

  return undefined;
};

const parseOAuthTokens = (value: unknown): OAuthTokens | undefined => {
  const parsed = OAuthTokensSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const parsePersistedMcpOAuthState = (
  value: unknown,
): PersistedMcpOAuthState | undefined => {
  if (!isRecord(value) || !isNonEmptyString(value.url)) {
    return undefined;
  }

  const clientInformation = parseOAuthClientInformation(value.clientInformation);
  const tokens = parseOAuthTokens(value.tokens);

  return {
    url: value.url.trim(),
    updatedAt: isNonEmptyString(value.updatedAt)
      ? value.updatedAt.trim()
      : new Date().toISOString(),
    ...(clientInformation !== undefined ? { clientInformation } : {}),
    ...(tokens !== undefined ? { tokens } : {}),
  };
};

const parsePersistedMcpOAuthFile = (value: unknown): PersistedMcpOAuthFile => {
  if (!isRecord(value) || !isRecord(value.servers)) {
    return { servers: {} };
  }

  const servers: Record<string, PersistedMcpOAuthState> = {};
  for (const [serverKey, serverState] of Object.entries(value.servers)) {
    const parsedState = parsePersistedMcpOAuthState(serverState);
    if (parsedState !== undefined) {
      servers[serverKey] = parsedState;
    }
  }

  return { servers };
};

const sanitizeNameToken = (value: string): string => {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized.length > 0 ? sanitized : "mcp";
};

const parseToolOutputMode = (value: unknown): McpToolOutputMode | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "full" || normalized === "expanded") {
    return "full";
  }

  if (normalized === "collapsed" || normalized === "collapse") {
    return "collapsed";
  }

  if (normalized === "muted" || normalized === "mute" || normalized === "hidden") {
    return "muted";
  }

  return null;
};

const parseToolOutputModesByTool = (
  value: unknown,
): Readonly<Record<string, McpToolOutputMode>> => {
  if (!isRecord(value)) {
    return {};
  }

  const parsed: Record<string, McpToolOutputMode> = {};
  for (const [rawToolName, rawMode] of Object.entries(value)) {
    const toolName = rawToolName.trim();
    if (toolName.length === 0) {
      continue;
    }

    const mode = parseToolOutputMode(rawMode);
    if (mode === null) {
      continue;
    }

    parsed[toolName] = mode;
  }

  return parsed;
};

const resolveServerOutputMode = (rawServer: JsonRecord): McpToolOutputMode =>
  parseToolOutputMode(rawServer.outputMode) ??
  parseToolOutputMode(rawServer.output) ??
  "full";

const resolveServerOutputModesByTool = (
  rawServer: JsonRecord,
): Readonly<Record<string, McpToolOutputMode>> => {
  const legacyModes = parseToolOutputModesByTool(rawServer.outputByTool);
  const explicitModes = parseToolOutputModesByTool(rawServer.outputModesByTool);
  return {
    ...legacyModes,
    ...explicitModes,
  };
};

const resolveToolOutputMode = (
  definition: McpServerDefinition,
  mcpToolName: string,
): McpToolOutputMode => {
  const byExactName = definition.outputModesByTool[mcpToolName];
  if (byExactName !== undefined) {
    return byExactName;
  }

  const bySanitizedName = definition.outputModesByTool[sanitizeNameToken(mcpToolName)];
  if (bySanitizedName !== undefined) {
    return bySanitizedName;
  }

  return definition.outputMode;
};

const renderUnknownAsText = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const truncateContent = (content: string): string => {
  const truncation = truncateHead(content, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return truncation.content;
  }

  return [
    truncation.content,
    `[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`,
  ].join("\n\n");
};

const extractPrimaryTextContent = (content: readonly unknown[]): string => {
  for (const part of content) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      return part.text;
    }
  }

  return "MCP tool returned no content.";
};

const countLines = (value: string): number => {
  if (value.length === 0) {
    return 0;
  }

  return value.split("\n").length;
};

const takePreviewLines = (
  value: string,
  lineLimit: number,
): {
  readonly preview: string;
  readonly omittedLineCount: number;
} => {
  if (lineLimit <= 0 || value.length === 0) {
    return {
      preview: "",
      omittedLineCount: countLines(value),
    };
  }

  const lines = value.split("\n");
  if (lines.length <= lineLimit) {
    return {
      preview: value,
      omittedLineCount: 0,
    };
  }

  return {
    preview: lines.slice(0, lineLimit).join("\n"),
    omittedLineCount: lines.length - lineLimit,
  };
};

const summarizeInputSchema = (inputSchema: JsonRecord): string | null => {
  const properties = inputSchema.properties;
  if (!isRecord(properties)) {
    return null;
  }

  const requiredSet = new Set<string>(
    Array.isArray(inputSchema.required)
      ? inputSchema.required.filter((value): value is string => typeof value === "string")
      : [],
  );

  const summaries: string[] = [];
  for (const [name, schemaValue] of Object.entries(properties)) {
    if (!isRecord(schemaValue)) {
      continue;
    }

    const fieldType = isNonEmptyString(schemaValue.type)
      ? schemaValue.type
      : "unknown";
    const required = requiredSet.has(name) ? "required" : "optional";
    const description = isNonEmptyString(schemaValue.description)
      ? ` - ${schemaValue.description.trim()}`
      : "";
    summaries.push(`${name} (${fieldType}, ${required})${description}`);

    if (summaries.length >= 8) {
      break;
    }
  }

  if (summaries.length === 0) {
    return null;
  }

  return `Input fields: ${summaries.join("; ")}`;
};

const createRuntime = (definition: McpServerDefinition): McpRuntime => ({
  definition,
  client: null,
  transport: null,
  connectPromise: null,
  toolsByPiName: new Map(),
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
});

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
};

const parseMcpDefinitions = (
  rawConfig: string,
  configPath: string,
): readonly McpServerDefinition[] => {
  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown JSON parse error";
    throw new Error(
      `Failed to parse ${configPath}: ${message}. Ensure the file contains valid JSON.`,
    );
  }

  if (!isRecord(parsedConfig)) {
    return [];
  }

  const servers = parsedConfig.servers;
  if (!isRecord(servers)) {
    return [];
  }

  const definitions: McpServerDefinition[] = [];
  for (const [rawKey, rawValue] of Object.entries(servers)) {
    if (!isRecord(rawValue) || !isNonEmptyString(rawValue.type)) {
      continue;
    }

    const key = sanitizeNameToken(rawKey);
    const enabled = rawValue.enabled !== false;
    const outputMode = resolveServerOutputMode(rawValue);
    const outputModesByTool = resolveServerOutputModesByTool(rawValue);

    if (rawValue.type === "remote") {
      if (!isNonEmptyString(rawValue.url)) {
        continue;
      }

      definitions.push({
        key,
        type: "remote",
        url: rawValue.url.trim(),
        enabled,
        outputMode,
        outputModesByTool,
      });
      continue;
    }

    if (rawValue.type !== "local") {
      continue;
    }

    const rawCommand = rawValue.command;
    const rawArgs = rawValue.args;

    let command: string;
    let args: readonly string[];

    if (Array.isArray(rawCommand)) {
      const commandParts = rawCommand
        .filter((part): part is string => isNonEmptyString(part))
        .map((part) => part.trim());

      if (commandParts.length === 0) {
        continue;
      }

      command = commandParts[0];
      args = commandParts.slice(1);
    } else if (isNonEmptyString(rawCommand)) {
      command = rawCommand.trim();
      args = Array.isArray(rawArgs)
        ? rawArgs
            .filter((part): part is string => isNonEmptyString(part))
            .map((part) => part.trim())
        : [];
    } else {
      continue;
    }

    const env: Record<string, string> = {};
    if (isRecord(rawValue.env)) {
      for (const [name, value] of Object.entries(rawValue.env)) {
        if (isNonEmptyString(value)) {
          env[name] = value;
        }
      }
    }

    definitions.push({
      key,
      type: "local",
      command,
      args,
      env,
      cwd: isNonEmptyString(rawValue.cwd) ? rawValue.cwd : null,
      enabled,
      outputMode,
      outputModesByTool,
    });
  }

  return definitions;
};

const createOAuthProvider = (
  runtime: McpRuntime,
  onStateChange: (runtime: McpRuntime) => void,
): OAuthClientProvider | null => {
  if (runtime.definition.type !== "remote" || runtime.oauthState === null) {
    return null;
  }

  const oauthState = runtime.oauthState;
  const clientMetadata: OAuthClientMetadata = {
    client_name: `Pi MCP (${runtime.definition.key})`,
    redirect_uris: [oauthState.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };

  return {
    get redirectUrl() {
      return oauthState.redirectUrl;
    },

    get clientMetadata() {
      return clientMetadata;
    },

    clientInformation() {
      return oauthState.clientInformation;
    },

    saveClientInformation(clientInformation) {
      oauthState.clientInformation = clientInformation;
      onStateChange(runtime);
    },

    tokens() {
      return oauthState.tokens;
    },

    saveTokens(tokens) {
      oauthState.tokens = tokens;
      onStateChange(runtime);
    },

    redirectToAuthorization(authorizationUrl) {
      oauthState.pendingAuthorizationUrl = authorizationUrl;
    },

    saveCodeVerifier(codeVerifier) {
      oauthState.codeVerifier = codeVerifier;
    },

    codeVerifier() {
      if (!isNonEmptyString(oauthState.codeVerifier)) {
        throw new Error("OAuth code verifier is missing for this session.");
      }
      return oauthState.codeVerifier;
    },

    saveDiscoveryState(discoveryState) {
      oauthState.discoveryState = discoveryState;
      onStateChange(runtime);
    },

    discoveryState() {
      return oauthState.discoveryState;
    },

    invalidateCredentials(scope) {
      if (scope === "all" || scope === "client") {
        oauthState.clientInformation = undefined;
      }

      if (scope === "all" || scope === "tokens") {
        oauthState.tokens = undefined;
      }

      if (scope === "all" || scope === "verifier") {
        oauthState.codeVerifier = undefined;
      }

      if (scope === "all" || scope === "discovery") {
        oauthState.discoveryState = undefined;
      }

      onStateChange(runtime);
    },
  };
};

const createTransport = (
  definition: McpServerDefinition,
  oauthProvider: OAuthClientProvider | null,
): StreamableHTTPClientTransport | StdioClientTransport => {
  if (definition.type === "remote") {
    return new StreamableHTTPClientTransport(new URL(definition.url), {
      authProvider: oauthProvider ?? undefined,
    });
  }

  return new StdioClientTransport({
    command: definition.command,
    args: [...definition.args],
    env: { ...definition.env },
    cwd: definition.cwd ?? undefined,
  });
};

const parseAuthorizationCodeInput = (input: string): string | null => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const callbackUrl = new URL(trimmed);
      const code = callbackUrl.searchParams.get("code");
      if (isNonEmptyString(code)) {
        return code;
      }
    } catch {
      // fall through and treat as raw code
    }
  }

  return trimmed;
};

const renderCallbackHtml = (title: string, message: string): string =>
  [
    "<!doctype html>",
    "<html>",
    "  <head><meta charset=\"utf-8\"><title>Pi MCP OAuth</title></head>",
    "  <body style=\"font-family: sans-serif; padding: 24px;\">",
    `    <h2>${title}</h2>`,
    `    <p>${message}</p>`,
    "    <p>You can close this tab and return to Pi.</p>",
    "  </body>",
    "</html>",
  ].join("\n");

const waitForOAuthCallbackCode = async (
  serverKey: string,
  timeoutMs: number,
): Promise<OAuthCallbackCaptureResult> => {
  const callbackUrl = new URL(`${OAUTH_CALLBACK_BASE_URL}/${encodeURIComponent(serverKey)}`);
  const expectedPath = callbackUrl.pathname;
  const host = callbackUrl.hostname;
  const port =
    callbackUrl.port.length > 0
      ? Number(callbackUrl.port)
      : callbackUrl.protocol === "https:"
        ? 443
        : 80;

  if (!Number.isFinite(port) || port <= 0) {
    return {
      status: "unavailable",
      message: `Invalid OAuth callback port in redirect URL: ${callbackUrl.toString()}`,
    };
  }

  return await new Promise<OAuthCallbackCaptureResult>((resolve) => {
    let settled = false;

    const server = createServer((request, response) => {
      const writeHtml = (statusCode: number, title: string, message: string) => {
        response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
        response.end(renderCallbackHtml(title, message));
      };

      const rawUrl = request.url;
      if (!isNonEmptyString(rawUrl)) {
        writeHtml(400, "Invalid callback", "The callback request URL was empty.");
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawUrl, `http://${host}:${port}`);
      } catch {
        writeHtml(400, "Invalid callback", "Could not parse callback URL.");
        return;
      }

      if (parsedUrl.pathname !== expectedPath) {
        writeHtml(404, "Unexpected callback", `Expected path: ${expectedPath}`);
        return;
      }

      const oauthError = parsedUrl.searchParams.get("error");
      if (isNonEmptyString(oauthError)) {
        const oauthErrorDescription = parsedUrl.searchParams.get("error_description");
        const message = isNonEmptyString(oauthErrorDescription)
          ? `${oauthError}: ${oauthErrorDescription}`
          : oauthError;

        writeHtml(400, "Authorization failed", message);
        settle({
          status: "error",
          message: `OAuth server returned an error for ${serverKey}: ${message}`,
        });
        return;
      }

      const code = parsedUrl.searchParams.get("code");
      if (isNonEmptyString(code)) {
        writeHtml(200, "Authorization received", "Pi captured your OAuth callback successfully.");
        settle({ status: "code", code });
        return;
      }

      writeHtml(
        400,
        "Authorization code missing",
        "The callback did not include a code query parameter.",
      );
      settle({
        status: "error",
        message: `OAuth callback for ${serverKey} did not include a code parameter.`,
      });
    });

    const timeoutId = setTimeout(() => {
      settle({ status: "timeout" });
    }, timeoutMs);

    const settle = (result: OAuthCallbackCaptureResult) => {
      if (settled) {
        return;
      }
      settled = true;

      clearTimeout(timeoutId);
      server.close(() => {
        resolve(result);
      });
    };

    server.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      settle({ status: "unavailable", message });
    });

    server.listen(port, host);
  });
};

const ensureConnected = async (
  runtime: McpRuntime,
  requestAuthorizationCode: ((serverKey: string, authorizationUrl: URL) => Promise<string>) | null,
  onOAuthStateChange: (runtime: McpRuntime) => void,
): Promise<Client> => {
  if (runtime.client !== null) {
    return runtime.client;
  }

  if (runtime.connectPromise !== null) {
    return runtime.connectPromise;
  }

  runtime.connectPromise = (async () => {
    const client = new Client({
      name: `pi-mcp-${runtime.definition.key}`,
      version: "1.0.0",
    });

    const oauthProvider = createOAuthProvider(runtime, onOAuthStateChange);
    const initialTransport = createTransport(runtime.definition, oauthProvider);
    let connectedTransport: StreamableHTTPClientTransport | StdioClientTransport =
      initialTransport;

    try {
      await client.connect(initialTransport);
    } catch (error) {
      if (
        error instanceof UnauthorizedError &&
        initialTransport instanceof StreamableHTTPClientTransport &&
        runtime.oauthState !== null
      ) {
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
        const parsedCode = parseAuthorizationCodeInput(authorizationCode);

        if (!isNonEmptyString(parsedCode)) {
          throw new Error(
            `No authorization code was provided for MCP server ${runtime.definition.key}.`,
          );
        }

        await initialTransport.finishAuth(parsedCode);

        try {
          await initialTransport.close();
        } catch {
          // best-effort cleanup before reconnecting with fresh transport
        }

        const authenticatedTransport = createTransport(runtime.definition, oauthProvider);
        await client.connect(authenticatedTransport);
        connectedTransport = authenticatedTransport;
      } else {
        throw error;
      }
    }

    client.onclose = () => {
      runtime.client = null;
      runtime.transport = null;
    };

    runtime.client = client;
    runtime.transport = connectedTransport;
    return client;
  })();

  try {
    return await runtime.connectPromise;
  } finally {
    runtime.connectPromise = null;
  }
};

const listAllTools = async (
  client: Client,
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
    const page = await client.listTools({ cursor });
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

const formatToolContent = (content: unknown): string => {
  if (!Array.isArray(content) || content.length === 0) {
    return "MCP tool returned no content.";
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!isRecord(item) || !isNonEmptyString(item.type)) {
      parts.push(renderUnknownAsText(item));
      continue;
    }

    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
      continue;
    }

    if (item.type === "resource_link") {
      const name = isNonEmptyString(item.name) ? item.name : "resource";
      const uri = isNonEmptyString(item.uri) ? item.uri : "(unknown uri)";
      parts.push(`Resource link: ${name} (${uri})`);
      continue;
    }

    if (item.type === "resource" && isRecord(item.resource)) {
      const uri = isNonEmptyString(item.resource.uri)
        ? item.resource.uri
        : "(unknown uri)";
      if (typeof item.resource.text === "string") {
        parts.push(`Resource: ${uri}\n${item.resource.text}`);
      } else {
        parts.push(`Resource: ${uri} (binary content omitted)`);
      }
      continue;
    }

    if (item.type === "image") {
      const mimeType = isNonEmptyString(item.mimeType) ? item.mimeType : "unknown";
      parts.push(`Image content omitted (${mimeType}).`);
      continue;
    }

    if (item.type === "audio") {
      const mimeType = isNonEmptyString(item.mimeType) ? item.mimeType : "unknown";
      parts.push(`Audio content omitted (${mimeType}).`);
      continue;
    }

    parts.push(renderUnknownAsText(item));
  }

  return parts.join("\n\n");
};

const closeRuntime = async (runtime: McpRuntime): Promise<void> => {
  const client = runtime.client;
  runtime.client = null;
  runtime.transport = null;

  if (client !== null) {
    try {
      await client.close();
    } catch {
      // best-effort cleanup
    }
  }
};

export default function mcpExtension(pi: ExtensionAPI) {
  const runtimes = new Map<string, McpRuntime>();
  const toolNamesByServer = new Map<string, readonly string[]>();
  const loadedServerKeys = new Set<string>();
  const configuredDefinitionsByKey = new Map<string, McpServerDefinition>();
  const registeredPiToolNames = new Set<string>();
  let defaultEnabledServers = new Set<string>();
  let sessionEnabledServers = new Set<string>();
  let initialized = false;
  let initializationPromise: Promise<void> | null = null;
  let authStateLoaded = false;
  let authStateWriteQueue: Promise<void> = Promise.resolve();
  let lastOAuthUi: OAuthUi | null = null;
  const persistedAuthByServer = new Map<string, PersistedMcpOAuthState>();

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

  const applySessionServerSelection = () => {
    const activeTools = new Set(pi.getActiveTools());

    for (const toolNames of toolNamesByServer.values()) {
      for (const toolName of toolNames) {
        activeTools.delete(toolName);
      }
    }

    for (const serverKey of sessionEnabledServers) {
      const toolNames = toolNamesByServer.get(serverKey);
      if (toolNames === undefined) {
        continue;
      }

      for (const toolName of toolNames) {
        activeTools.add(toolName);
      }
    }

    pi.setActiveTools(Array.from(activeTools));
  };

  const persistSessionServerSelection = () => {
    pi.appendEntry<McpSessionState>("mcp-session-config", {
      enabledServers: Array.from(sessionEnabledServers).sort((a, b) =>
        a.localeCompare(b),
      ),
    });
  };

  const restoreSessionServerSelectionFromBranch = (ctx: ExtensionContext) => {
    let savedEnabledServers: readonly string[] | undefined;

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== "mcp-session-config") {
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
    applySessionServerSelection();
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

  const loadServerDefinition = async (
    definition: McpServerDefinition,
    requestAuthorizationCode: ((serverKey: string, authorizationUrl: URL) => Promise<string>) | null,
  ): Promise<DiscoveryFailure | null> => {
    if (loadedServerKeys.has(definition.key)) {
      return null;
    }

    const runtime = createRuntime(definition);
    hydrateRuntimeAuthState(runtime);

    try {
      const connectionTimeoutMs =
        requestAuthorizationCode === null
          ? CONNECTION_TIMEOUT_MS
          : INTERACTIVE_AUTH_TIMEOUT_MS;

      const client = await withTimeout(
        ensureConnected(runtime, requestAuthorizationCode, updatePersistedAuthFromRuntime),
        connectionTimeoutMs,
        `Connecting to MCP server ${definition.key}`,
      );

      const tools = await withTimeout(
        listAllTools(client),
        connectionTimeoutMs,
        `Listing tools from MCP server ${definition.key}`,
      );

      runtimes.set(runtime.definition.key, runtime);
      loadedServerKeys.add(runtime.definition.key);

      const serverToolNames: string[] = [];
      for (const tool of tools) {
        const baseName = `${sanitizeNameToken(runtime.definition.key)}_${sanitizeNameToken(tool.name)}`;
        let piToolName = baseName;
        let duplicateIndex = 2;
        while (registeredPiToolNames.has(piToolName)) {
          piToolName = `${baseName}_${duplicateIndex}`;
          duplicateIndex += 1;
        }
        registeredPiToolNames.add(piToolName);

        const inputSummary = summarizeInputSchema(tool.inputSchema);
        const descriptionParts = [
          `MCP tool ${tool.name} from server ${runtime.definition.key}.`,
          tool.description ?? "",
          inputSummary ?? "Accepts a JSON object of arguments.",
        ].filter((part) => part.trim().length > 0);

        const registeredTool: McpRegisteredTool = {
          mcpToolName: tool.name,
          piToolName,
          description: descriptionParts.join(" "),
          outputMode: resolveToolOutputMode(runtime.definition, tool.name),
        };

        runtime.toolsByPiName.set(piToolName, registeredTool);

        pi.registerTool({
          name: piToolName,
          label: `MCP ${runtime.definition.key}/${tool.name}`,
          description: registeredTool.description,
          parameters: OpenObjectParams,

          async execute(_toolCallId, params, _signal, _onUpdate, toolCtx) {
            const activeRuntime = runtimes.get(runtime.definition.key);
            if (activeRuntime === undefined) {
              throw new Error(
                `MCP server ${runtime.definition.key} is not active. Reload extensions and try again.`,
              );
            }

            const toolOauthUi: OAuthUi | null = toolCtx.hasUI
              ? {
                  notify: toolCtx.ui.notify.bind(toolCtx.ui),
                  input: toolCtx.ui.input.bind(toolCtx.ui),
                }
              : null;
            const requestToolAuthorizationCode = createAuthorizationCodeRequester(toolOauthUi);

            let client = await ensureConnected(
              activeRuntime,
              requestToolAuthorizationCode,
              updatePersistedAuthFromRuntime,
            );
            let callResult;

            try {
              callResult = await client.callTool({
                name: registeredTool.mcpToolName,
                arguments: params,
              });
            } catch (error) {
              if (error instanceof UnauthorizedError) {
                await closeRuntime(activeRuntime);
                client = await ensureConnected(
                  activeRuntime,
                  requestToolAuthorizationCode,
                  updatePersistedAuthFromRuntime,
                );
                callResult = await client.callTool({
                  name: registeredTool.mcpToolName,
                  arguments: params,
                });
              } else {
                throw error;
              }
            }

            const content = isRecord(callResult)
              ? callResult.content
              : undefined;
            const output = truncateContent(formatToolContent(content));
            const isError =
              isRecord(callResult) && typeof callResult.isError === "boolean"
                ? callResult.isError
                : false;
            const structuredContent =
              isRecord(callResult) && isRecord(callResult.structuredContent)
                ? callResult.structuredContent
                : null;

            if (isError) {
              throw new Error(
                `MCP tool ${runtime.definition.key}/${registeredTool.mcpToolName} returned an error: ${output}`,
              );
            }

            return {
              content: [{ type: "text", text: output }],
              details: {
                server: runtime.definition.key,
                mcpTool: registeredTool.mcpToolName,
                outputMode: registeredTool.outputMode,
                structuredContent,
              },
            };
          },

          renderResult(result, { expanded }, theme) {
            const output = extractPrimaryTextContent(result.content);
            if (registeredTool.outputMode === "full" || expanded) {
              return new Text(output, 0, 0);
            }

            const expandHint = keyHint("expandTools", "for full output");
            if (registeredTool.outputMode === "muted") {
              const header =
                theme.fg("muted", "(output hidden)") +
                (output.trim().length > 0
                  ? `\n${theme.fg("muted", `(${expandHint})`)}`
                  : "");
              return new Text(header, 0, 0);
            }

            const { preview, omittedLineCount } = takePreviewLines(
              output,
              MCP_COLLAPSED_PREVIEW_LINES,
            );

            let text = preview.length > 0 ? preview : theme.fg("muted", "(no output)");
            if (omittedLineCount > 0) {
              text +=
                `\n${theme.fg("muted", `... ${omittedLineCount} more lines`)}` +
                `\n${theme.fg("muted", `(${expandHint})`)}`;
            }

            return new Text(text, 0, 0);
          },
        });

        serverToolNames.push(piToolName);
      }

      toolNamesByServer.set(runtime.definition.key, serverToolNames);
      return null;
    } catch (error) {
      await closeRuntime(runtime);
      const message = error instanceof Error ? error.message : String(error);
      return { key: definition.key, message };
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
      initialized = true;

      await ensureAuthStateLoaded(oauthUi);

      let rawConfig: string;
      try {
        rawConfig = await readFile(MCP_CONFIG_PATH, "utf8");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown file read error";
        if (oauthUi !== null) {
          oauthUi.notify(
            `MCP config load failed: ${message}. Expected: ${MCP_CONFIG_PATH}`,
            "warning",
          );
        }
        return;
      }

      let definitions: readonly McpServerDefinition[];
      try {
        definitions = parseMcpDefinitions(rawConfig, MCP_CONFIG_PATH);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (oauthUi !== null) {
          oauthUi.notify(message, "error");
        }
        return;
      }

      configuredDefinitionsByKey.clear();
      for (const definition of definitions) {
        configuredDefinitionsByKey.set(definition.key, definition);
      }

      const enabledDefinitions = definitions.filter((definition) => definition.enabled);
      defaultEnabledServers = new Set(enabledDefinitions.map((definition) => definition.key));
      sessionEnabledServers = new Set(defaultEnabledServers);

      const requestAuthorizationCode = createAuthorizationCodeRequester(oauthUi);
      const failures: DiscoveryFailure[] = [];

      for (const definition of enabledDefinitions) {
        const failure = await loadServerDefinition(definition, requestAuthorizationCode);
        if (failure !== null) {
          failures.push(failure);
        }
      }

      applySessionServerSelection();

      if (oauthUi !== null) {
        for (const failure of failures) {
          oauthUi.notify(`MCP server ${failure.key} failed: ${failure.message}`, "warning");
        }
      }
    })().finally(() => {
      initializationPromise = null;
    });

    return initializationPromise;
  };

  pi.registerCommand("mcp", {
    description: "Toggle MCP servers for this session",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      const oauthUi: OAuthUi = {
        notify: ctx.ui.notify.bind(ctx.ui),
        input: ctx.ui.input.bind(ctx.ui),
      };

      await initializeFromConfig(oauthUi);

      if (configuredDefinitionsByKey.size === 0) {
        ctx.ui.notify("No MCP servers are configured.", "warning");
        return;
      }

      const desiredEnabledServers = new Set(sessionEnabledServers);

      const sortedServerNames = Array.from(configuredDefinitionsByKey.keys()).sort((a, b) =>
        a.localeCompare(b),
      );

      while (true) {
        const optionToServer = new Map<string, string>();
        const serverOptions = sortedServerNames.map((serverName) => {
          const definition = configuredDefinitionsByKey.get(serverName);
          const typeLabel = definition?.type ?? "unknown";
          const enabledLabel = desiredEnabledServers.has(serverName) ? "on" : "off";
          const loadedLabel = loadedServerKeys.has(serverName) ? "" : " · lazy";
          const option = `[${enabledLabel}] ${serverName} (${typeLabel})${loadedLabel}`;
          optionToServer.set(option, serverName);
          return option;
        });

        const choice = await ctx.ui.select("MCP servers (session)", [
          "Done",
          "Enable all",
          "Disable all",
          ...serverOptions,
        ]);

        if (!isNonEmptyString(choice) || choice === "Done") {
          break;
        }

        if (choice === "Enable all") {
          for (const serverName of sortedServerNames) {
            desiredEnabledServers.add(serverName);
          }
          continue;
        }

        if (choice === "Disable all") {
          desiredEnabledServers.clear();
          continue;
        }

        const selectedServerName = optionToServer.get(choice);
        if (!isNonEmptyString(selectedServerName)) {
          continue;
        }

        if (desiredEnabledServers.has(selectedServerName)) {
          desiredEnabledServers.delete(selectedServerName);
        } else {
          desiredEnabledServers.add(selectedServerName);
        }
      }

      const previousEnabledServers = new Set(sessionEnabledServers);
      const requestAuthorizationCode = createAuthorizationCodeRequester(oauthUi);
      const nextEnabledServers = new Set<string>();

      for (const serverKey of desiredEnabledServers) {
        const definition = configuredDefinitionsByKey.get(serverKey);
        if (definition === undefined) {
          continue;
        }

        const failure = await loadServerDefinition(definition, requestAuthorizationCode);
        if (failure !== null) {
          ctx.ui.notify(
            `MCP server ${failure.key} could not be enabled: ${failure.message}`,
            "warning",
          );
          continue;
        }

        nextEnabledServers.add(serverKey);
      }

      const hasChanged =
        previousEnabledServers.size !== nextEnabledServers.size ||
        Array.from(previousEnabledServers).some((serverKey) => !nextEnabledServers.has(serverKey));

      sessionEnabledServers = nextEnabledServers;
      applySessionServerSelection();

      if (hasChanged) {
        persistSessionServerSelection();
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    const oauthUi: OAuthUi | null =
      ctx.hasUI
        ? {
            notify: ctx.ui.notify.bind(ctx.ui),
            input: ctx.ui.input.bind(ctx.ui),
          }
        : null;

    const startupInitialization = initializeFromConfig(oauthUi);

    if (!ctx.hasUI) {
      return startupInitialization.then(() => {
        restoreSessionServerSelectionFromBranch(ctx);
      });
    }

    void startupInitialization
      .then(() => {
        restoreSessionServerSelectionFromBranch(ctx);
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
    restoreSessionServerSelectionFromBranch(ctx);
  });

  pi.on("session_fork", async (_event, ctx) => {
    restoreSessionServerSelectionFromBranch(ctx);
  });

  pi.on("session_shutdown", async () => {
    const closures = Array.from(runtimes.values()).map(closeRuntime);
    await Promise.all(closures);

    await authStateWriteQueue;

    runtimes.clear();
    toolNamesByServer.clear();
    loadedServerKeys.clear();
    configuredDefinitionsByKey.clear();
    registeredPiToolNames.clear();
    defaultEnabledServers.clear();
    sessionEnabledServers.clear();
    persistedAuthByServer.clear();
    authStateLoaded = false;
    lastOAuthUi = null;
  });
}
