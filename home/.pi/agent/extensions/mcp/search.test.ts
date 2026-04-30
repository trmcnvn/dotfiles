import { describe, expect, test } from "bun:test";
import { renderToolSearch } from "./renderers.js";
import { findToolMatches } from "./search.js";
import type { McpRegisteredTool } from "./types.js";

const tool = (
  name: string,
  description: string,
  inputSchema: Record<string, unknown> = { type: "object" },
): McpRegisteredTool => ({
  mcpToolName: name,
  piToolName: `server_${name}`,
  description,
  inputSchema,
  outputMode: "full",
});

const discoveredTools = new Map<string, readonly McpRegisteredTool[]>([
  [
    "docs",
    [
      tool("resolve-library-id", "Resolve package names before fetching docs"),
      tool("get-library-docs", "Fetch documentation for a resolved package"),
    ],
  ],
  [
    "errors",
    [tool("list-issues", "Search production error issues")],
  ],
]);

describe("MCP tool search", () => {
  test("plain search is case-insensitive substring search", () => {
    const result = findToolMatches(discoveredTools, "PACKAGE", {
      regex: false,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.message);
    }
    expect(result.matches.map((match) => match.tool.mcpToolName)).toEqual([
      "get-library-docs",
      "resolve-library-id",
    ]);
  });

  test("regex search matches names and descriptions", () => {
    const result = findToolMatches(discoveredTools, "^(server_)?list-", {
      regex: true,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.message);
    }
    expect(result.matches.map((match) => `${match.serverKey}/${match.tool.mcpToolName}`)).toEqual([
      "errors/list-issues",
    ]);
  });

  test("invalid regex returns a clear error", () => {
    const result = findToolMatches(discoveredTools, "[", {
      regex: true,
    });

    expect(result.status).toBe("invalid_regex");
    if (result.status !== "invalid_regex") {
      throw new Error("Expected invalid_regex result");
    }
    expect(result.message).toContain("Invalid MCP search regex");
  });

  test("search can be scoped by server", () => {
    const result = findToolMatches(discoveredTools, "search", {
      regex: false,
      serverKey: "docs",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.message);
    }
    expect(result.matches).toHaveLength(0);
  });

  test("search rendering keeps schemas hidden by default and includes them on request", () => {
    const schemaTool = tool("with-schema", "Tool with structured input", {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Topic to inspect",
        },
      },
      required: ["topic"],
    });
    const matches = [{ serverKey: "docs", tool: schemaTool }];

    const compact = renderToolSearch("schema", matches, false, false, false);
    expect(compact).toContain("server_with-schema");
    expect(compact).not.toContain("Input schema");
    expect(compact).not.toContain("Topic to inspect");

    const verbose = renderToolSearch("schema", matches, false, false, true);
    expect(verbose).toContain("Input schema");
    expect(verbose).toContain("Topic to inspect");
  });
});
