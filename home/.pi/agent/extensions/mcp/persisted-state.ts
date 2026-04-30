import {
  OAuthClientInformationFullSchema,
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  JsonRecord,
  PersistedMcpDiscoveryFile,
  PersistedMcpDiscoveryState,
  PersistedMcpDiscoveryTool,
  PersistedMcpOAuthFile,
  PersistedMcpOAuthState,
} from "./types.js";
import { isNonEmptyString, isRecord } from "./utils.js";

export const parseOAuthClientInformation = (
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

export const parseOAuthTokens = (value: unknown): OAuthTokens | undefined => {
  const parsed = OAuthTokensSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

export const parsePersistedMcpOAuthState = (
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

export const parsePersistedMcpOAuthFile = (value: unknown): PersistedMcpOAuthFile => {
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

export const parsePersistedMcpDiscoveryTool = (
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

export const parsePersistedMcpDiscoveryState = (
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

export const parsePersistedMcpDiscoveryFile = (value: unknown): PersistedMcpDiscoveryFile => {
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
