import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
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
  DynamicBorder,
  formatSize,
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Container, SelectList, Text, type SelectItem } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const MCP_CONFIG_PATH =
  process.env.PI_MCP_CONFIG_PATH ?? join(homedir(), ".pi", "agent", "mcp.json");
const MCP_AUTH_STATE_PATH =
  process.env.PI_MCP_AUTH_PATH ?? join(homedir(), ".pi", "agent", "mcp-auth.json");
const MCP_DISCOVERY_CACHE_PATH = join(homedir(), ".pi", "agent", "mcp-discovery-cache.json");
const CONNECTION_TIMEOUT_MS = 15_000;
const INTERACTIVE_AUTH_TIMEOUT_MS = 10 * 60_000;
const OAUTH_CALLBACK_WAIT_TIMEOUT_MS = 5 * 60_000;
const OAUTH_CALLBACK_BASE_URL = "http://127.0.0.1:54545/callback";
const MCP_COLLAPSED_PREVIEW_LINES = 14;
const MCP_DISCOVERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const IDLE_CONNECTION_TIMEOUT_MS = 10 * 60_000;
const MCP_SESSION_CONFIG_TYPE = "mcp-proxy-session-config";

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
  readonly inputSchema: JsonRecord;
  readonly outputMode: McpToolOutputMode;
};

type TruncateContentResult = {
  readonly text: string;
  readonly truncated: boolean;
  readonly fullOutputPath: string | null;
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
  oauthState: McpOAuthState | null;
  lastActivityAt: number;
  activeRequestCount: number;
  idleCloseTimer: ReturnType<typeof setTimeout> | null;
  idleCloseGeneration: number;
};

type McpConfig = {
  readonly definitions: readonly McpServerDefinition[];
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

type PersistedMcpDiscoveryTool = {
  readonly mcpToolName: string;
  readonly piToolName: string;
  readonly description: string;
  readonly inputSchema: JsonRecord;
};

type PersistedMcpDiscoveryState = {
  readonly definitionHash: string;
  readonly updatedAt: string;
  readonly tools: readonly PersistedMcpDiscoveryTool[];
};

type PersistedMcpDiscoveryFile = {
  readonly servers: Readonly<Record<string, PersistedMcpDiscoveryState>>;
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

const parsePersistedMcpDiscoveryTool = (
  value: unknown,
): PersistedMcpDiscoveryTool | undefined => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.mcpToolName) ||
    !isNonEmptyString(value.piToolName)
  ) {
    return undefined;
  }

  return {
    mcpToolName: value.mcpToolName.trim(),
    piToolName: value.piToolName.trim(),
    description: isNonEmptyString(value.description) ? value.description.trim() : "",
    inputSchema: isRecord(value.inputSchema) ? value.inputSchema : { type: "object" },
  };
};

const parsePersistedMcpDiscoveryState = (
  value: unknown,
): PersistedMcpDiscoveryState | undefined => {
  if (!isRecord(value) || !isNonEmptyString(value.definitionHash)) {
    return undefined;
  }

  const tools = Array.isArray(value.tools)
    ? value.tools
        .map((tool) => parsePersistedMcpDiscoveryTool(tool))
        .filter((tool): tool is PersistedMcpDiscoveryTool => tool !== undefined)
    : [];

  return {
    definitionHash: value.definitionHash.trim(),
    updatedAt: isNonEmptyString(value.updatedAt)
      ? value.updatedAt.trim()
      : new Date().toISOString(),
    tools,
  };
};

const parsePersistedMcpDiscoveryFile = (value: unknown): PersistedMcpDiscoveryFile => {
  if (!isRecord(value) || !isRecord(value.servers)) {
    return { servers: {} };
  }

  const servers: Record<string, PersistedMcpDiscoveryState> = {};
  for (const [serverKey, serverState] of Object.entries(value.servers)) {
    const parsedState = parsePersistedMcpDiscoveryState(serverState);
    if (parsedState !== undefined) {
      servers[serverKey] = parsedState;
    }
  }

  return { servers };
};

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? "undefined" : serialized;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as JsonRecord)[key])}`)
    .join(",")}}`;
};

const computeDefinitionHash = (definition: McpServerDefinition): string => {
  const identity: JsonRecord =
    definition.type === "remote"
      ? {
          type: definition.type,
          url: definition.url,
        }
      : {
          type: definition.type,
          command: definition.command,
          args: [...definition.args],
          env: definition.env,
          cwd: definition.cwd,
        };

  return createHash("sha256").update(stableStringify(identity)).digest("hex");
};

const isPersistedDiscoveryStateFresh = (state: PersistedMcpDiscoveryState): boolean => {
  const updatedAtMs = Date.parse(state.updatedAt);
  return Number.isFinite(updatedAtMs)
    ? Date.now() - updatedAtMs <= MCP_DISCOVERY_CACHE_MAX_AGE_MS
    : false;
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

const truncateContent = async (content: string): Promise<TruncateContentResult> => {
  const truncation = truncateHead(content, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return {
      text: truncation.content,
      truncated: false,
      fullOutputPath: null,
    };
  }

  const omittedLines = truncation.totalLines - truncation.outputLines;
  const omittedBytes = truncation.totalBytes - truncation.outputBytes;

  let fullOutputPath: string | null = null;
  try {
    const tempDir = await mkdtemp(join(tmpdir(), "pi-mcp-tool-"));
    fullOutputPath = join(tempDir, "output.txt");
    await writeFile(fullOutputPath, content, "utf8");
  } catch {
    fullOutputPath = null;
  }

  const truncationNoticeParts = [
    `Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`,
    `${omittedLines} lines (${formatSize(omittedBytes)}) omitted.`,
    fullOutputPath === null
      ? "Could not persist full output to a temp file."
      : `Full output saved to: ${fullOutputPath}`,
  ];

  return {
    text: [truncation.content, `[${truncationNoticeParts.join(" ")}]`].join("\n\n"),
    truncated: true,
    fullOutputPath,
  };
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

    if (summaries.length >= 4) {
      break;
    }
  }

  if (summaries.length === 0) {
    return null;
  }

  return `Input fields: ${summaries.join("; ")}`;
};

const createRegisteredTools = (
  definition: McpServerDefinition,
  tools: readonly {
    readonly name: string;
    readonly description: string | null;
    readonly inputSchema: JsonRecord;
  }[],
): readonly McpRegisteredTool[] => {
  const registeredTools: McpRegisteredTool[] = [];
  const seenPiNames = new Set<string>();

  for (const tool of tools) {
    const baseName = `${sanitizeNameToken(definition.key)}_${sanitizeNameToken(tool.name)}`;
    let piToolName = baseName;
    let duplicateIndex = 2;
    while (seenPiNames.has(piToolName)) {
      piToolName = `${baseName}_${duplicateIndex}`;
      duplicateIndex += 1;
    }
    seenPiNames.add(piToolName);

    const inputSummary = summarizeInputSchema(tool.inputSchema);
    const descriptionParts = [
      `MCP tool ${tool.name} from server ${definition.key}.`,
      tool.description ?? "",
      inputSummary ?? "Accepts a JSON object of arguments.",
    ].filter((part) => part.trim().length > 0);

    registeredTools.push({
      mcpToolName: tool.name,
      piToolName,
      description: descriptionParts.join(" "),
      inputSchema: tool.inputSchema,
      outputMode: resolveToolOutputMode(definition, tool.name),
    });
  }

  return registeredTools;
};

const hydrateRegisteredTools = (
  definition: McpServerDefinition,
  persistedTools: readonly PersistedMcpDiscoveryTool[],
): readonly McpRegisteredTool[] =>
  persistedTools.map((tool) => ({
    mcpToolName: tool.mcpToolName,
    piToolName: tool.piToolName,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputMode: resolveToolOutputMode(definition, tool.mcpToolName),
  }));

const createRuntime = (definition: McpServerDefinition): McpRuntime => ({
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

const parseMcpConfig = (rawConfig: string, configPath: string): McpConfig => {
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
    return {
      definitions: [],
    };
  }

  const servers = parsedConfig.servers;
  if (!isRecord(servers)) {
    return {
      definitions: [],
    };
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

  return {
    definitions,
  };
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
      clearIdleCloseTimer(runtime);
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

const clearIdleCloseTimer = (runtime: McpRuntime) => {
  if (runtime.idleCloseTimer !== null) {
    clearTimeout(runtime.idleCloseTimer);
    runtime.idleCloseTimer = null;
  }
};

const touchRuntime = (runtime: McpRuntime) => {
  runtime.lastActivityAt = Date.now();
  runtime.idleCloseGeneration += 1;
  clearIdleCloseTimer(runtime);
};

const closeRuntime = async (runtime: McpRuntime): Promise<void> => {
  const client = runtime.client;
  const transport = runtime.transport;
  runtime.client = null;
  runtime.transport = null;
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
};

const scheduleIdleClose = (runtime: McpRuntime) => {
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

const withRuntimeLease = async <T>(
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

export default function mcpExtension(pi: ExtensionAPI) {
  const runtimes = new Map<string, McpRuntime>();
  const discoveredToolsByServer = new Map<string, readonly McpRegisteredTool[]>();
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
      queuePersistedDiscoveryWrite();
      return;
    }

    discoveredToolsByServer.set(
      definition.key,
      hydrateRegisteredTools(definition, persisted.tools),
    );
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

  const ensureServerMetadata = async (
    definition: McpServerDefinition,
    requestAuthorizationCode: ((serverKey: string, authorizationUrl: URL) => Promise<string>) | null,
    forceRefresh = false,
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
      const connectionTimeoutMs =
        requestAuthorizationCode === null
          ? CONNECTION_TIMEOUT_MS
          : INTERACTIVE_AUTH_TIMEOUT_MS;

      const registeredTools = await withRuntimeLease(runtime, async () => {
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

        return createRegisteredTools(definition, tools);
      });

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
  ) => {
    const requestToolAuthorizationCode = createAuthorizationCodeRequester(toolOauthUi);

    const callResult = await withRuntimeLease(runtime, async () => {
      let client = await ensureConnected(
        runtime,
        requestToolAuthorizationCode,
        updatePersistedAuthFromRuntime,
      );

      try {
        return await client.callTool({
          name: registeredTool.mcpToolName,
          arguments: params,
        });
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          await closeRuntime(runtime);
          client = await ensureConnected(
            runtime,
            requestToolAuthorizationCode,
            updatePersistedAuthFromRuntime,
          );
          return await client.callTool({
            name: registeredTool.mcpToolName,
            arguments: params,
          });
        }

        throw error;
      }
    });

    const content = isRecord(callResult) ? callResult.content : undefined;
    const output = await truncateContent(formatToolContent(content));
    const isError =
      isRecord(callResult) && typeof callResult.isError === "boolean"
        ? callResult.isError
        : false;
    const structuredContent =
      isRecord(callResult) && isRecord(callResult.structuredContent)
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
  ): Promise<readonly McpRegisteredTool[]> => {
    if (!isServerEnabledForSession(serverKey)) {
      throw new Error(
        `MCP server ${serverKey} is disabled in this session. Use /mcp to enable it.`,
      );
    }

    const definition = configuredDefinitionsByKey.get(serverKey);
    if (definition === undefined) {
      throw new Error(`Unknown MCP server: ${serverKey}`);
    }

    return await ensureServerMetadata(definition, requestAuthorizationCode, forceRefresh);
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
    serverKey?: string,
  ): readonly {
    readonly serverKey: string;
    readonly tool: McpRegisteredTool;
  }[] => {
    const searchQuery = query.trim().toLowerCase();

    return Array.from(discoveredToolsByServer.entries())
      .filter(
        ([candidateServerKey]) =>
          serverKey === undefined || candidateServerKey === serverKey,
      )
      .flatMap(([candidateServerKey, tools]) =>
        tools
          .filter((tool) => {
            const haystack = `${tool.piToolName}\n${tool.mcpToolName}\n${tool.description}`.toLowerCase();
            return haystack.includes(searchQuery);
          })
          .map((tool) => ({ serverKey: candidateServerKey, tool })),
      )
      .sort((left, right) => left.tool.piToolName.localeCompare(right.tool.piToolName));
  };

  const refreshDiscoveryScopeBestEffort = async (serverKey?: string): Promise<void> => {
    const refreshes = getSearchScopeServerKeys(serverKey)
      .filter((candidateServerKey) => !discoveredToolsByServer.has(candidateServerKey))
      .map(async (candidateServerKey) => {
        const definition = configuredDefinitionsByKey.get(candidateServerKey);
        if (definition === undefined) {
          return;
        }

        try {
          await ensureServerMetadata(definition, null);
        } catch {
          // best-effort warm-up only; explicit refresh still surfaces failures
        }
      });

    await Promise.allSettled(refreshes);
  };

  const formatInputSchemaForText = (inputSchema: JsonRecord): string =>
    renderUnknownAsText(inputSchema);

  const renderProxyStatus = (): string => {
    const lines = ["MCP servers:"];

    for (const serverKey of Array.from(configuredDefinitionsByKey.keys()).sort((a, b) =>
      a.localeCompare(b),
    )) {
      lines.push(
        `- ${serverKey} · ${sessionEnabledServers.has(serverKey) ? "enabled" : "disabled"}`,
      );
    }

    lines.push("", "Use /mcp to toggle servers for this session.");
    return lines.join("\n");
  };

  const renderServerToolList = (
    serverKey: string,
    tools: readonly McpRegisteredTool[],
  ): string => {
    const definition = configuredDefinitionsByKey.get(serverKey);
    const lines = [`MCP server ${serverKey}${definition === undefined ? "" : ` (${definition.type})`}`];

    if (tools.length === 0) {
      lines.push("No tools discovered.");
      return lines.join("\n");
    }

    lines.push(
      `${tools.length} tool${tools.length === 1 ? "" : "s"}. Use \`tool\` with the full name below. Use /mcp if this server should be enabled or disabled in this session.`,
      "",
    );

    for (const tool of tools) {
      lines.push(`- ${tool.piToolName}: ${tool.description}`);
    }

    return lines.join("\n");
  };

  const renderToolDescription = (serverKey: string, tool: McpRegisteredTool): string => {
    const lines = [
      `Tool: ${tool.piToolName}`,
      `Server: ${serverKey}`,
      `MCP name: ${tool.mcpToolName}`,
      `Description: ${tool.description}`,
      "",
      "Input schema:",
      formatInputSchemaForText(tool.inputSchema),
    ];

    return lines.join("\n");
  };

  const renderToolSearch = (
    query: string,
    matches: readonly {
      readonly serverKey: string;
      readonly tool: McpRegisteredTool;
    }[],
    refreshed: boolean,
    autoRefreshed: boolean,
  ): string => {
    if (matches.length === 0) {
      if (autoRefreshed) {
        return `No MCP tools matched \"${query}\". Some undiscovered servers may still require auth or a manual refresh; try mcp({ search: \"${query}\", refresh: true }) or inspect a specific server.`;
      }

      return refreshed
        ? `No MCP tools matched \"${query}\".`
        : `No discovered MCP tools matched \"${query}\". Try mcp({ search: \"${query}\", refresh: true }) or list a specific server first.`;
    }

    const lines = [`Found ${matches.length} MCP tool${matches.length === 1 ? "" : "s"} matching \"${query}\":`, ""];
    for (const match of matches.slice(0, 40)) {
      lines.push(`- ${match.tool.piToolName}: ${match.tool.description}`);
    }

    if (matches.length > 40) {
      lines.push("", `... ${matches.length - 40} more results`);
    }

    return lines.join("\n");
  };

  const formatGatewayToolOutput = (
    tool: McpRegisteredTool,
    output: string,
  ): string => {
    if (tool.outputMode === "muted") {
      return "(output hidden by MCP outputMode configuration)";
    }

    if (tool.outputMode === "collapsed") {
      const { preview, omittedLineCount } = takePreviewLines(
        output,
        MCP_COLLAPSED_PREVIEW_LINES,
      );

      if (omittedLineCount === 0) {
        return preview;
      }

      return `${preview}\n... ${omittedLineCount} more lines`;
    }

    return output;
  };

  const createProxyTextResult = async (
    text: string,
    details: JsonRecord,
  ) => {
    const output = await truncateContent(text);
    return {
      content: [{ type: "text" as const, text: output.text }],
      details: {
        ...details,
        truncated: output.truncated,
        fullOutputPath: output.fullOutputPath,
      },
    };
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
      await ensureDiscoveryCacheLoaded(oauthUi);

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

      let config: McpConfig;
      try {
        config = parseMcpConfig(rawConfig, MCP_CONFIG_PATH);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (oauthUi !== null) {
          oauthUi.notify(message, "error");
        }
        return;
      }

      configuredDefinitionsByKey.clear();
      discoveredToolsByServer.clear();
      for (const definition of config.definitions) {
        configuredDefinitionsByKey.set(definition.key, definition);
        hydrateDiscoveredToolsFromCache(definition);
      }

      const enabledDefinitions = config.definitions.filter((definition) => definition.enabled);
      defaultEnabledServers = new Set(enabledDefinitions.map((definition) => definition.key));
      sessionEnabledServers = new Set(defaultEnabledServers);
    })().finally(() => {
      initializationPromise = null;
    });

    return initializationPromise;
  };

  const selectSessionDiscoverabilityChoice = async (
    ctx: ExtensionContext,
    sortedServerNames: readonly string[],
    desiredEnabledServers: ReadonlySet<string>,
  ): Promise<string | null> =>
    await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
      const items: SelectItem[] = [
        { value: "__done__", label: "Done" },
        { value: "__enable_all__", label: "Enable all" },
        { value: "__disable_all__", label: "Disable all" },
        ...sortedServerNames.map((serverName) => {
          const checkmark = desiredEnabledServers.has(serverName)
            ? theme.fg("success", "✓")
            : " ";

          return {
            value: serverName,
            label: `${checkmark} ${serverName}`,
          };
        }),
      ];

      const container = new Container();
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
      container.addChild(
        new Text(theme.fg("accent", theme.bold("MCP servers (✓ enabled)")), 1, 0),
      );

      const selectList = new SelectList(items, Math.min(items.length, 14), {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => text,
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });
      selectList.onSelect = (item) => done(item.value);
      selectList.onCancel = () => done(null);
      container.addChild(selectList);
      container.addChild(
        new Text(theme.fg("dim", "↑↓ navigate • enter toggle • esc done"), 1, 0),
      );
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    });

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
      describe: Type.Optional(
        Type.String({ description: "Describe a tool by full name or raw MCP name" }),
      ),
      tool: Type.Optional(
        Type.String({ description: "Call a tool by full name or raw MCP name" }),
      ),
      args: Type.Optional(OpenObjectParams),
      refresh: Type.Optional(
        Type.Boolean({ description: "Refresh discovery metadata before reading it" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, toolCtx) {
      const toolOauthUi: OAuthUi | null = toolCtx.hasUI
        ? {
            notify: toolCtx.ui.notify.bind(toolCtx.ui),
            input: toolCtx.ui.input.bind(toolCtx.ui),
          }
        : null;

      await initializeFromConfig(toolOauthUi);

      if (configuredDefinitionsByKey.size === 0) {
        return {
          content: [{ type: "text", text: "No MCP servers are configured." }],
          details: { mode: "status" },
        };
      }

      const requestAuthorizationCode = createAuthorizationCodeRequester(toolOauthUi);
      const serverKey = isNonEmptyString(params.server) ? params.server.trim() : undefined;
      const refresh = params.refresh === true;

      if (isNonEmptyString(params.tool)) {
        const toolReference = params.tool.trim();
        const hintedServerKey = serverKey ?? inferServerKeyFromToolReference(toolReference) ?? undefined;

        if (hintedServerKey !== undefined) {
          await ensureToolsForServer(
            hintedServerKey,
            requestAuthorizationCode,
            refresh || !discoveredToolsByServer.has(hintedServerKey),
          );
        }

        const resolvedTool = resolveToolReference(toolReference, serverKey);
        if (resolvedTool === null) {
          throw new Error(
            `Unknown MCP tool: ${toolReference}. Use mcp({ search: \"...\" }) or mcp({ server: \"...\" }) to inspect available tools.`,
          );
        }

        const runtime = getOrCreateRuntime(resolvedTool.definition);
        const result = await invokeMcpTool(
          runtime,
          resolvedTool.tool,
          isRecord(params.args) ? params.args : {},
          toolOauthUi,
        );

        if (result.isError) {
          throw new Error(
            `MCP tool ${resolvedTool.definition.key}/${resolvedTool.tool.mcpToolName} returned an error: ${result.output.text}`,
          );
        }

        return {
          content: [
            {
              type: "text",
              text: formatGatewayToolOutput(resolvedTool.tool, result.output.text),
            },
          ],
          details: {
            mode: "tool",
            server: resolvedTool.definition.key,
            mcpTool: resolvedTool.tool.mcpToolName,
            outputMode: resolvedTool.tool.outputMode,
            truncated: result.output.truncated,
            fullOutputPath: result.output.fullOutputPath,
            structuredContent: result.structuredContent,
          },
        };
      }

      if (isNonEmptyString(params.describe)) {
        const toolReference = params.describe.trim();
        const hintedServerKey = serverKey ?? inferServerKeyFromToolReference(toolReference) ?? undefined;

        if (hintedServerKey !== undefined) {
          await ensureToolsForServer(
            hintedServerKey,
            requestAuthorizationCode,
            refresh || !discoveredToolsByServer.has(hintedServerKey),
          );
        }

        const resolvedTool = resolveToolReference(toolReference, serverKey);
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

      if (isNonEmptyString(params.search)) {
        if (serverKey !== undefined) {
          await ensureToolsForServer(
            serverKey,
            requestAuthorizationCode,
            refresh || !discoveredToolsByServer.has(serverKey),
          );
        } else if (refresh) {
          for (const candidateServerKey of getSearchScopeServerKeys()) {
            const definition = configuredDefinitionsByKey.get(candidateServerKey);
            if (definition === undefined) {
              continue;
            }

            await ensureServerMetadata(definition, requestAuthorizationCode, true);
          }
        }

        let matches = findToolMatches(params.search.trim(), serverKey);
        let autoRefreshed = false;

        if (!refresh && matches.length === 0 && hasUndiscoveredSearchScope(serverKey)) {
          await refreshDiscoveryScopeBestEffort(serverKey);
          matches = findToolMatches(params.search.trim(), serverKey);
          autoRefreshed = true;
        }

        return await createProxyTextResult(
          renderToolSearch(
            params.search.trim(),
            matches,
            refresh || autoRefreshed,
            autoRefreshed,
          ),
          {
            mode: "search",
            refreshed: refresh || autoRefreshed,
            autoRefreshed,
            resultCount: matches.length,
          },
        );
      }

      if (serverKey !== undefined) {
        const tools = await ensureToolsForServer(
          serverKey,
          requestAuthorizationCode,
          refresh || !discoveredToolsByServer.has(serverKey),
        );

        return await createProxyTextResult(renderServerToolList(serverKey, tools), {
          mode: "list",
          server: serverKey,
          refreshed: refresh,
          toolCount: tools.length,
        });
      }

      return await createProxyTextResult(renderProxyStatus(), { mode: "status" });
    },
  });

  pi.registerCommand("mcp", {
    description: "Enable or disable MCP servers for this session",
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
        const choice = await selectSessionDiscoverabilityChoice(
          ctx,
          sortedServerNames,
          desiredEnabledServers,
        );

        if (choice === null || choice === "__done__") {
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

      const previousEnabledServers = new Set(sessionEnabledServers);
      const nextEnabledServers = new Set<string>();

      for (const serverKey of desiredEnabledServers) {
        if (configuredDefinitionsByKey.has(serverKey)) {
          nextEnabledServers.add(serverKey);
        }
      }

      const hasChanged =
        previousEnabledServers.size !== nextEnabledServers.size ||
        Array.from(previousEnabledServers).some((serverKey) => !nextEnabledServers.has(serverKey));

      sessionEnabledServers = nextEnabledServers;

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
        return restoreSessionServerSelectionFromBranch(ctx);
      });
    }

    void startupInitialization
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

  pi.on("session_fork", async (_event, ctx) => {
    await restoreSessionServerSelectionFromBranch(ctx);
  });

  pi.on("session_shutdown", async () => {
    const closures = Array.from(runtimes.values()).map(closeRuntime);
    await Promise.all(closures);

    await authStateWriteQueue;
    await discoveryCacheWriteQueue;

    runtimes.clear();
    discoveredToolsByServer.clear();
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
