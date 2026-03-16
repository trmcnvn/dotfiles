# MCP Extension Agent Notes

Scope: `home/.pi/agent/extensions/mcp/*`

## Responsibilities

- Load MCP server definitions from `~/.pi/agent/mcp.json`.
- Respect `PI_MCP_CONFIG_PATH` override for config location.
- Register the compact `mcp` gateway tool for low-token discovery/calling.
- Keep per-session MCP server discoverable/hidden state in session history (`mcp-proxy-session-config`).
- Keep global config file unchanged when `/mcp` toggles are used.

## Stable Behavior Contracts

- Tool naming format must remain: `<server-key>_<tool-name>`.
- `mcp.json` `enabled: true` means the server is discoverable by default via the compact `mcp` gateway.
- `/mcp` toggles whether a configured server is discoverable for the current session only.
- Support both server types:
  - `remote` (Streamable HTTP)
  - `local` (stdio command/args)
- Only servers with `"enabled": true` are discoverable by default.
- OAuth flow must work in interactive mode and fail clearly in non-interactive modes.
- OAuth callback base URL is loopback: `http://127.0.0.1:54545/callback/<server>`.
- Optional MCP output display config is read from `mcp.json` per server:
  - `outputMode`: `"full" | "collapsed" | "muted"` (default: `"full"`)
  - `outputModesByTool`: map of MCP tool name -> output mode (overrides `outputMode`)

## Data / Secret Paths

- MCP config: `~/.pi/agent/mcp.json` (`PI_MCP_CONFIG_PATH`)
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
