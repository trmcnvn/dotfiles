# MCP Extension Agent Notes

Scope: `home/.pi/agent/extensions/mcp/*`

## Responsibilities

- Load MCP server definitions from `~/.pi/agent/mcp.json` plus optional project-local `.pi/mcp.json` overrides.
- Respect `PI_MCP_CONFIG_PATH` override for the user config location.
- Register the compact `mcp` gateway tool for low-token discovery/calling.
- Keep per-session MCP server discoverable/hidden state in session history (`mcp-proxy-session-config`).
- Keep global config file unchanged when `/mcp` toggles are used.

## Stable Behavior Contracts

- Tool naming format must remain: `<server-key>_<tool-name>`.
- Accepted config top-level server maps: `servers`, `mcpServers`, `mcp-servers`.
- `mcp.json` `enabled: true` means the server is discoverable by default via the compact `mcp` gateway.
- Missing `enabled` defaults to disabled for safety.
- Project-local `.pi/mcp.json` overrides user config by server key.
- `/mcp` with no arguments toggles whether a configured server is discoverable for the current session only.
- `/mcp status` shows configured servers, session/default enablement, cached/discovered tool counts, connection state, and auth state.
- `/mcp reconnect <server>` closes any existing runtime for that server and refreshes discovery metadata.
- `/mcp tools [server]` lists currently discovered or cached tools, optionally scoped to one server.
- Support both server types:
  - `remote` (preferred transport: Streamable HTTP, optional SSE fallback / explicit SSE)
  - `local` (stdio command/args)
- Only servers with `"enabled": true` are discoverable by default.
- OAuth flow must work in interactive mode and fail clearly in non-interactive modes.
- OAuth callback base URL is loopback: `http://127.0.0.1:54545/callback/<server>`.
- Remote `mcp.json` entries may also specify:
  - `headers`: extra HTTP headers for remote requests
  - `timeout` / `timeoutMs`: per-request timeout in milliseconds
  - `transport`: `"auto" | "streamable-http" | "sse"`
  - `auth: "bearer"` with `bearerTokenEnv` (preferred) or `bearerToken`; this sets `Authorization: Bearer <token>` and replaces any configured `Authorization`/`authorization` header deterministically without logging token values.
- Optional MCP output display config is read from `mcp.json` per server:
  - `outputMode`: `"full" | "collapsed" | "muted"` (default: `"full"`)
  - `outputModesByTool`: map of MCP tool name -> output mode (overrides `outputMode`)
- Optional direct Pi tools are disabled by default. Enable only selected cached MCP tools with per-server `directTools: ["tool_name"]` or `MCP_DIRECT_TOOLS=server/tool,server/other_tool`.
- The `mcp` gateway search keeps compact output by default; optional search flags:
  - `regex`: treat `search` as a case-insensitive regular expression
  - `includeSchemas`: include input schemas in search results
- The `mcp` gateway may expose prompt/resource actions inside the same tool surface:
  - `listPrompts`
  - `getPrompt`
  - `listResources`
  - `readResource`

## Module Map

- `index.ts`: extension state wiring, persistence queues, session lifecycle hooks.
- `gateway-tool.ts`: compact `mcp` gateway registration and action routing.
- `direct-tools.ts`: optional allowlisted MCP tool registration as direct Pi tools.
- `commands.ts` / `session-picker.ts`: `/mcp` command and interactive session toggles.
- `config.ts`: config parsing, transport/output-mode parsing, definition hashing.
- `runtime.ts` / `transport.ts` / `oauth.ts`: connection lifecycle, transports, OAuth provider/callback handling.
- `persisted-state.ts`: persisted OAuth/discovery state validation.
- `tool-registry.ts`: MCP tool metadata normalization and Pi tool name generation.
- `content-format.ts` / `renderers.ts` / `output-policy.ts`: output normalization, truncation, and display policy.
- `types.ts`, `constants.ts`, `utils.ts`, `schema.ts`: shared domain types and helpers.

## Data / Secret Paths

- MCP config: `~/.pi/agent/mcp.json` (`PI_MCP_CONFIG_PATH`) and optional project `.pi/mcp.json`
- OAuth state/tokens: `~/.pi/agent/mcp-auth.json` (`PI_MCP_AUTH_PATH`)
- Discovery cache: `~/.pi/agent/mcp-discovery-cache.json`

Treat `mcp-auth.json` as secret material. Never print or log raw tokens.

## Editing Rules

- Keep parsing permissive and backward compatible.
- Avoid provider- or vendor-specific assumptions.
- Preserve output normalization + truncation behavior.
- If you add/change env vars, document them here and in `README.md`.
- If you add/change user-visible behavior, update `/mcp` flow docs.

## Quick Validation

- Basic smoke: `pi --mode json --no-session "noop"`
- If tool naming/parsing changed, verify tool names are still generated as `<server>_<tool>`.
