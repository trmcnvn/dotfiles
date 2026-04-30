import { describe, expect, test } from "bun:test";
import {
  getMcpCommandArgumentCompletions,
  parseMcpCommandArgs,
  renderMcpCommandReconnectResult,
  renderMcpCommandStatus,
  renderMcpCommandTools,
  type McpCommandServerStatus,
  type McpCommandToolsResult,
} from "./commands.js";
import type { McpRegisteredTool } from "./types.js";

const tool = (name: string): McpRegisteredTool => ({
  mcpToolName: name,
  piToolName: `docs_${name}`,
  description: `Tool ${name}`,
  inputSchema: { type: "object" },
  outputMode: "full",
});

describe("MCP slash command parsing", () => {
  test("keeps empty /mcp as the interactive toggle", () => {
    expect(parseMcpCommandArgs("   ")).toEqual({ kind: "toggle" });
  });

  test("parses status, tools, and reconnect subcommands", () => {
    expect(parseMcpCommandArgs("status")).toEqual({ kind: "status" });
    expect(parseMcpCommandArgs("tools docs")).toEqual({
      kind: "tools",
      serverKey: "docs",
    });
    expect(parseMcpCommandArgs("reconnect docs")).toEqual({
      kind: "reconnect",
      serverKey: "docs",
    });
  });

  test("rejects invalid arity with usage-friendly messages", () => {
    expect(parseMcpCommandArgs("reconnect")).toEqual({
      kind: "invalid",
      message: "/mcp reconnect requires exactly one server key.",
    });
    expect(parseMcpCommandArgs("tools docs extra")).toEqual({
      kind: "invalid",
      message: "/mcp tools accepts at most one server key.",
    });
  });
});

describe("MCP slash command completions", () => {
  test("completes subcommands", () => {
    const completions = getMcpCommandArgumentCompletions("re", ["docs"]);
    expect(completions).not.toBeNull();
    expect(completions?.map((item) => item.value)).toEqual(["reconnect "]);
  });

  test("completes server keys for reconnect and tools", () => {
    const completions = getMcpCommandArgumentCompletions("reconnect d", [
      "docs",
      "errors",
    ]);
    expect(completions?.map((item) => item.value)).toEqual(["reconnect docs"]);

    const toolsCompletions = getMcpCommandArgumentCompletions("tools ", [
      "docs",
      "errors",
    ]);
    expect(toolsCompletions?.map((item) => item.value)).toEqual([
      "tools docs",
      "tools errors",
    ]);
  });
});

describe("MCP slash command rendering", () => {
  test("renders status with session, cache, runtime, and auth details", () => {
    const statuses: readonly McpCommandServerStatus[] = [
      {
        serverKey: "docs",
        serverType: "remote",
        configuredEnabled: true,
        sessionEnabled: false,
        transport: "auto",
        cachedToolCount: 2,
        discoveredToolCount: 1,
        connectionStatus: "failure",
        authStatus: "auth required",
        lastFailureMessage: "OAuth authorization is required for MCP server docs.",
      },
    ];

    const rendered = renderMcpCommandStatus(statuses);
    expect(rendered).toContain("docs");
    expect(rendered).toContain("session disabled");
    expect(rendered).toContain("cached=2 discovered=1");
    expect(rendered).toContain("connection=failure");
    expect(rendered).toContain("auth=auth required");
  });

  test("renders cached and discovered tool lists", () => {
    const result: McpCommandToolsResult = {
      status: "ok",
      serverTools: [
        {
          serverKey: "docs",
          source: "cached",
          cachedToolCount: 1,
          discoveredToolCount: 0,
          tools: [tool("search")],
        },
      ],
    };

    const rendered = renderMcpCommandTools(result);
    expect(rendered).toContain("source=cached");
    expect(rendered).toContain("docs_search");
  });

  test("renders reconnect success and failure results", () => {
    expect(
      renderMcpCommandReconnectResult({
        status: "ok",
        serverKey: "docs",
        closedRuntime: true,
        toolCount: 2,
      }),
    ).toContain("Refreshed discovery metadata: 2 tools");

    expect(
      renderMcpCommandReconnectResult({
        status: "failed",
        serverKey: "docs",
        closedRuntime: false,
        message: "connection refused",
      }),
    ).toContain("Reason: connection refused");
  });
});
