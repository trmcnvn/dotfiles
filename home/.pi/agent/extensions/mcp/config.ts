import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MCP_CONFIG_PATH, MCP_DISCOVERY_CACHE_MAX_AGE_MS, CONNECTION_TIMEOUT_MS } from "./constants.js";
import type { JsonRecord, McpConfig, McpRemoteTransport, McpServerDefinition, PersistedMcpDiscoveryState } from "./types.js";
import type { McpToolOutputMode } from "./output-policy.js";
import { isNonEmptyString, isRecord, sanitizeNameToken, stableStringify } from "./utils.js";

const PROJECT_MCP_CONFIG_RELATIVE_PATH = [".pi", "mcp.json"] as const;
const SERVER_COLLECTION_KEYS = ["servers", "mcpServers", "mcp-servers"] as const;

type ParsedServerType = "remote" | "local";
type ParsedRemoteAuthMode = "bearer";

const getProjectMcpConfigPath = (cwd: string): string =>
  resolve(cwd, ...PROJECT_MCP_CONFIG_RELATIVE_PATH);

const isMissingFileError = (error: unknown): boolean =>
  isRecord(error) && error.code === "ENOENT";

export const computeDefinitionHash = (definition: McpServerDefinition): string => {
  const identity: JsonRecord =
    definition.type === "remote"
      ? {
          type: definition.type,
          url: definition.url,
          headers: definition.headers,
          timeoutMs: definition.timeoutMs,
          transport: definition.transport,
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

export const isPersistedDiscoveryStateFresh = (state: PersistedMcpDiscoveryState): boolean => {
  const updatedAtMs = Date.parse(state.updatedAt);
  return Number.isFinite(updatedAtMs)
    ? Date.now() - updatedAtMs <= MCP_DISCOVERY_CACHE_MAX_AGE_MS
    : false;
};

export const parseToolOutputMode = (value: unknown): McpToolOutputMode | null => {
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

export const parseToolOutputModesByTool = (
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

export const parseDirectTools = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const tools: string[] = [];
  const seen = new Set<string>();
  for (const rawToolName of value) {
    if (!isNonEmptyString(rawToolName)) {
      continue;
    }

    const toolName = rawToolName.trim();
    if (seen.has(toolName)) {
      continue;
    }

    seen.add(toolName);
    tools.push(toolName);
  }

  return tools;
};

export const parseRemoteHeaders = (value: unknown): Readonly<Record<string, string>> => {
  if (!isRecord(value)) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const headerName = rawName.trim();
    if (headerName.length === 0) {
      continue;
    }

    if (
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      headers[headerName] = String(rawValue);
    }
  }

  return headers;
};

export const parseRemoteAuthMode = (value: unknown): ParsedRemoteAuthMode | null => {
  if (typeof value !== "string") {
    return null;
  }

  return value.trim().toLowerCase() === "bearer" ? "bearer" : null;
};

const resolveBearerToken = (rawServer: JsonRecord, serverKey: string): string | null => {
  if (parseRemoteAuthMode(rawServer.auth) !== "bearer") {
    return null;
  }

  const envName = isNonEmptyString(rawServer.bearerTokenEnv)
    ? rawServer.bearerTokenEnv.trim()
    : null;
  const envToken = envName === null ? undefined : process.env[envName];
  if (isNonEmptyString(envToken)) {
    return envToken.trim();
  }

  if (isNonEmptyString(rawServer.bearerToken)) {
    return rawServer.bearerToken.trim();
  }

  const recoveryHint =
    envName === null
      ? "Set bearerTokenEnv to the name of an environment variable containing the token, or set bearerToken."
      : `Set environment variable ${envName} to the bearer token, fix bearerTokenEnv, or set bearerToken.`;

  throw new Error(
    `MCP server ${serverKey} is configured with auth: "bearer", but no bearer token is available. ${recoveryHint}`,
  );
};

export const applyBearerAuthorizationHeader = (
  headers: Readonly<Record<string, string>>,
  bearerToken: string,
): Readonly<Record<string, string>> => {
  const mergedHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.trim().toLowerCase() === "authorization") {
      continue;
    }

    mergedHeaders[name] = value;
  }

  mergedHeaders.Authorization = `Bearer ${bearerToken}`;
  return mergedHeaders;
};

export const resolveRemoteHeaders = (
  rawServer: JsonRecord,
  serverKey: string,
): Readonly<Record<string, string>> => {
  const headers = parseRemoteHeaders(rawServer.headers);
  const bearerToken = resolveBearerToken(rawServer, serverKey);
  return bearerToken === null ? headers : applyBearerAuthorizationHeader(headers, bearerToken);
};

export const parseRemoteTimeoutMs = (value: unknown): number | null => {
  const parsedValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return Math.round(parsedValue);
};

export const parseRemoteTransport = (value: unknown): McpRemoteTransport | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "auto") {
    return "auto";
  }

  if (
    normalized === "streamable-http" ||
    normalized === "streamable_http" ||
    normalized === "streamablehttp" ||
    normalized === "http"
  ) {
    return "streamable-http";
  }

  if (normalized === "sse" || normalized === "eventsource") {
    return "sse";
  }

  return null;
};

export const resolveRemoteTransport = (rawServer: JsonRecord): McpRemoteTransport =>
  parseRemoteTransport(rawServer.transport) ??
  parseRemoteTransport(rawServer.remoteTransport) ??
  parseRemoteTransport(rawServer.transportPreference) ??
  "auto";

export const resolveRemoteTimeoutMs = (rawServer: JsonRecord): number =>
  parseRemoteTimeoutMs(rawServer.timeoutMs) ??
  parseRemoteTimeoutMs(rawServer.timeout) ??
  CONNECTION_TIMEOUT_MS;

export const resolveServerOutputMode = (rawServer: JsonRecord): McpToolOutputMode =>
  parseToolOutputMode(rawServer.outputMode) ??
  parseToolOutputMode(rawServer.output) ??
  "full";

export const resolveServerOutputModesByTool = (
  rawServer: JsonRecord,
): Readonly<Record<string, McpToolOutputMode>> => {
  const legacyModes = parseToolOutputModesByTool(rawServer.outputByTool);
  const explicitModes = parseToolOutputModesByTool(rawServer.outputModesByTool);
  return {
    ...legacyModes,
    ...explicitModes,
  };
};

export const resolveToolOutputMode = (
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

const parseServerType = (rawServer: JsonRecord): ParsedServerType | null => {
  if (typeof rawServer.type === "string") {
    const normalizedType = rawServer.type.trim().toLowerCase();
    if (normalizedType === "remote") {
      return "remote";
    }

    if (normalizedType === "local" || normalizedType === "stdio") {
      return "local";
    }
  }

  if (isNonEmptyString(rawServer.url)) {
    return "remote";
  }

  if (isNonEmptyString(rawServer.command) || Array.isArray(rawServer.command)) {
    return "local";
  }

  return null;
};

const parseServersRecord = (parsedConfig: JsonRecord): JsonRecord | null => {
  for (const key of SERVER_COLLECTION_KEYS) {
    const candidate = parsedConfig[key];
    if (isRecord(candidate)) {
      return candidate;
    }
  }

  return null;
};

export const parseMcpConfig = (rawConfig: string, configPath: string): McpConfig => {
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

  const servers = parseServersRecord(parsedConfig);
  if (servers === null) {
    return {
      definitions: [],
    };
  }

  const definitions: McpServerDefinition[] = [];
  for (const [rawKey, rawValue] of Object.entries(servers)) {
    if (!isRecord(rawValue)) {
      continue;
    }

    const serverType = parseServerType(rawValue);
    if (serverType === null) {
      continue;
    }

    const key = sanitizeNameToken(rawKey);
    const enabled = rawValue.enabled === true;
    const outputMode = resolveServerOutputMode(rawValue);
    const outputModesByTool = resolveServerOutputModesByTool(rawValue);
    const directTools = parseDirectTools(rawValue.directTools);

    if (serverType === "remote") {
      if (!isNonEmptyString(rawValue.url)) {
        continue;
      }

      definitions.push({
        key,
        type: "remote",
        url: rawValue.url.trim(),
        headers: resolveRemoteHeaders(rawValue, key),
        timeoutMs: resolveRemoteTimeoutMs(rawValue),
        transport: resolveRemoteTransport(rawValue),
        enabled,
        outputMode,
        outputModesByTool,
        directTools,
      });
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
      directTools,
    });
  }

  return {
    definitions,
  };
};

export const mergeMcpConfigs = (
  baseConfig: McpConfig,
  overrideConfig: McpConfig,
): McpConfig => {
  const definitionsByKey = new Map<string, McpServerDefinition>();

  for (const definition of baseConfig.definitions) {
    definitionsByKey.set(definition.key, definition);
  }

  for (const definition of overrideConfig.definitions) {
    definitionsByKey.set(definition.key, definition);
  }

  return {
    definitions: Array.from(definitionsByKey.values()),
  };
};

const readOptionalConfig = async (configPath: string): Promise<string | null> => {
  try {
    return await readFile(configPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    const message = error instanceof Error ? error.message : "unknown file read error";
    throw new Error(`Failed to read MCP config file ${configPath}: ${message}`);
  }
};

export type LoadMcpConfigOptions = {
  readonly configPath?: string;
  readonly cwd?: string;
};

export const loadMcpConfig = async (
  options: LoadMcpConfigOptions = {},
): Promise<McpConfig> => {
  const userConfigPath = resolve(options.configPath ?? MCP_CONFIG_PATH);
  const projectConfigPath = getProjectMcpConfigPath(options.cwd ?? process.cwd());

  const rawUserConfig = await readOptionalConfig(userConfigPath);
  const userConfig = rawUserConfig === null
    ? { definitions: [] }
    : parseMcpConfig(rawUserConfig, userConfigPath);

  if (projectConfigPath === userConfigPath) {
    return userConfig;
  }

  const rawProjectConfig = await readOptionalConfig(projectConfigPath);
  if (rawProjectConfig === null) {
    return userConfig;
  }

  const projectConfig = parseMcpConfig(rawProjectConfig, projectConfigPath);
  return mergeMcpConfigs(userConfig, projectConfig);
};
