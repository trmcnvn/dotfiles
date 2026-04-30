import { describe, expect, test } from "bun:test";
import {
  parseMcpDirectToolsEnv,
  registerDirectMcpTools,
  resolveDirectToolAllowlists,
  type DirectMcpToolDefinition,
  type DirectMcpToolRegistrar,
  type DirectMcpToolServices,
} from "./direct-tools.js";
import type { McpRegisteredTool, McpServerDefinition } from "./types.js";

const remoteDefinition = (
  key: string,
  directTools: readonly string[] = [],
): McpServerDefinition => ({
  key,
  type: "remote",
  url: `https://example.com/${key}`,
  headers: {},
  timeoutMs: 1_000,
  transport: "auto",
  enabled: true,
  outputMode: "full",
  outputModesByTool: {},
  directTools,
});

const mcpTool = (mcpToolName: string, piToolName: string): McpRegisteredTool => ({
  mcpToolName,
  piToolName,
  description: `Tool ${mcpToolName}`,
  inputSchema: { type: "object" },
  outputMode: "full",
});

const unusedServices: DirectMcpToolServices = {
  initializeFromConfig: async () => {},
  getOrCreateRuntime: () => {
    throw new Error("Direct tool execution was not expected in this test.");
  },
  invokeMcpTool: () => {
    throw new Error("Direct tool execution was not expected in this test.");
  },
};

const mapEntries = (
  allowlists: ReadonlyMap<string, ReadonlySet<string>>,
): [string, string[]][] =>
  Array.from(allowlists.entries()).map(([serverKey, tools]) => [
    serverKey,
    Array.from(tools),
  ]);

describe("MCP direct tools", () => {
  test("parses MCP_DIRECT_TOOLS entries", () => {
    const allowlists = parseMcpDirectToolsEnv(
      "docs/fetch, docs/search ,invalid,/missing-server,empty/,weird server/tool/name,docs/fetch",
    );

    expect(mapEntries(allowlists)).toEqual([
      ["docs", ["fetch", "search"]],
      ["weird_server", ["tool/name"]],
    ]);
  });

  test("merges per-server config allowlists with env overrides", () => {
    const definitions = [remoteDefinition("docs", ["fetch"])];
    const allowlists = resolveDirectToolAllowlists(
      definitions,
      "docs/search,other/list",
    );

    expect(mapEntries(allowlists)).toEqual([
      ["docs", ["fetch", "search"]],
      ["other", ["list"]],
    ]);
  });

  test("skips direct tool collisions with a warning", () => {
    const registeredTools: DirectMcpToolDefinition[] = [];
    const warnings: string[] = [];
    const pi: DirectMcpToolRegistrar = {
      getAllTools: () => [{ name: "docs_fetch" }],
      registerTool: (tool) => {
        registeredTools.push(tool);
      },
    };

    const registeredToolNames = registerDirectMcpTools(pi, {
      definitions: [remoteDefinition("docs", ["fetch", "search"])],
      discoveredToolsByServer: new Map([
        [
          "docs",
          [mcpTool("fetch", "docs_fetch"), mcpTool("search", "docs_search")],
        ],
      ]),
      services: unusedServices,
      warn: (message) => {
        warnings.push(message);
      },
    });

    expect(registeredToolNames).toEqual(["docs_search"]);
    expect(registeredTools.map((tool) => tool.name)).toEqual(["docs_search"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("docs_fetch");
    expect(warnings[0]).toContain("conflicts with an existing Pi tool");
  });

  test("prefers exact MCP names over sanitized fallback matches", () => {
    const registeredTools: DirectMcpToolDefinition[] = [];
    const pi: DirectMcpToolRegistrar = {
      getAllTools: () => [],
      registerTool: (tool) => {
        registeredTools.push(tool);
      },
    };

    const registeredToolNames = registerDirectMcpTools(pi, {
      definitions: [remoteDefinition("docs", ["a_b"])],
      discoveredToolsByServer: new Map([
        [
          "docs",
          [mcpTool("a/b", "docs_a_b"), mcpTool("a_b", "docs_a_b_2")],
        ],
      ]),
      services: unusedServices,
      warn: () => {},
    });

    expect(registeredToolNames).toEqual(["docs_a_b_2"]);
    expect(registeredTools.map((tool) => tool.name)).toEqual(["docs_a_b_2"]);
  });
});
