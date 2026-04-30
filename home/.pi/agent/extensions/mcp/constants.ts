import { homedir } from "node:os";
import { join } from "node:path";

export const MCP_CONFIG_PATH =
  process.env.PI_MCP_CONFIG_PATH ?? join(homedir(), ".pi", "agent", "mcp.json");
export const MCP_AUTH_STATE_PATH =
  process.env.PI_MCP_AUTH_PATH ?? join(homedir(), ".pi", "agent", "mcp-auth.json");
export const MCP_DISCOVERY_CACHE_PATH = join(homedir(), ".pi", "agent", "mcp-discovery-cache.json");
export const CONNECTION_TIMEOUT_MS = 15_000;
export const INTERACTIVE_AUTH_TIMEOUT_MS = 10 * 60_000;
export const OAUTH_CALLBACK_WAIT_TIMEOUT_MS = 5 * 60_000;
export const OAUTH_CALLBACK_BASE_URL = "http://127.0.0.1:54545/callback";
export const MCP_DISCOVERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const IDLE_CONNECTION_TIMEOUT_MS = 10 * 60_000;
export const MCP_SESSION_CONFIG_TYPE = "mcp-proxy-session-config";
