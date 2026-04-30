import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { loadMcpConfig, parseMcpConfig } from "./config.js";
import type { McpConfig, McpServerDefinition } from "./types.js";

const findDefinition = (
  config: McpConfig,
  key: string,
): McpServerDefinition => {
  const definition = config.definitions.find((candidate) => candidate.key === key);
  if (definition === undefined) {
    throw new Error(`Expected MCP definition ${key} to exist`);
  }

  return definition;
};

const parseConfigObject = (value: unknown): McpConfig =>
  parseMcpConfig(JSON.stringify(value), "inline-test.json");

const withEnv = <T>(name: string, value: string | undefined, fn: () => T): T => {
  const previousValue = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    return fn();
  } finally {
    if (previousValue === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previousValue;
    }
  }
};

describe("MCP config parsing", () => {
  test("accepts the existing top-level servers schema", () => {
    const config = parseConfigObject({
      servers: {
        docs: {
          type: "remote",
          url: "https://example.com/mcp",
          enabled: true,
        },
        local: {
          type: "local",
          command: "bunx",
          args: ["example-mcp"],
          enabled: true,
        },
      },
    });

    expect(config.definitions).toHaveLength(2);
    expect(findDefinition(config, "docs")).toMatchObject({
      type: "remote",
      url: "https://example.com/mcp",
      enabled: true,
    });
    expect(findDefinition(config, "local")).toMatchObject({
      type: "local",
      command: "bunx",
      args: ["example-mcp"],
      enabled: true,
    });
  });

  test("accepts mcpServers and mcp-servers top-level schemas", () => {
    for (const key of ["mcpServers", "mcp-servers"] as const) {
      const config = parseConfigObject({
        [key]: {
          inferredRemote: {
            url: "https://example.com/inferred",
          },
          inferredLocal: {
            command: "node",
            args: ["server.js"],
            enabled: true,
          },
        },
      });

      expect(config.definitions).toHaveLength(2);
      expect(findDefinition(config, "inferredRemote")).toMatchObject({
        type: "remote",
        enabled: false,
      });
      expect(findDefinition(config, "inferredLocal")).toMatchObject({
        type: "local",
        command: "node",
        args: ["server.js"],
        enabled: true,
      });
    }
  });

  test("preserves remote transport, timeout, headers, and output policies", () => {
    const config = parseConfigObject({
      mcpServers: {
        remote: {
          type: "remote",
          url: "https://example.com/mcp",
          headers: {
            "X-Test": "yes",
          },
          timeout: "2500",
          transport: "sse",
          outputMode: "collapsed",
          outputModesByTool: {
            secretTool: "muted",
          },
        },
      },
    });

    const definition = findDefinition(config, "remote");
    expect(definition.type).toBe("remote");
    if (definition.type !== "remote") {
      throw new Error("Expected remote definition");
    }

    expect(definition.headers).toEqual({ "X-Test": "yes" });
    expect(definition.timeoutMs).toBe(2500);
    expect(definition.transport).toBe("sse");
    expect(definition.outputMode).toBe("collapsed");
    expect(definition.outputModesByTool).toEqual({ secretTool: "muted" });
  });

  test("adds bearer auth from literal token to remote headers", () => {
    const config = parseConfigObject({
      mcpServers: {
        remote: {
          type: "remote",
          url: "https://example.com/mcp",
          headers: {
            "X-Test": "yes",
          },
          auth: "bearer",
          bearerToken: "literal-token",
        },
      },
    });

    const definition = findDefinition(config, "remote");
    if (definition.type !== "remote") {
      throw new Error("Expected remote definition");
    }

    expect(definition.headers).toEqual({
      "X-Test": "yes",
      Authorization: "Bearer literal-token",
    });
  });

  test("adds bearer auth from environment token to remote headers", () => {
    const config = withEnv("PI_MCP_TEST_BEARER_TOKEN", "env-token", () =>
      parseConfigObject({
        mcpServers: {
          remote: {
            type: "remote",
            url: "https://example.com/mcp",
            auth: "Bearer",
            bearerToken: "literal-token",
            bearerTokenEnv: "PI_MCP_TEST_BEARER_TOKEN",
          },
        },
      }),
    );

    const definition = findDefinition(config, "remote");
    if (definition.type !== "remote") {
      throw new Error("Expected remote definition");
    }

    expect(definition.headers).toEqual({
      Authorization: "Bearer env-token",
    });
  });

  test("fails clearly when configured bearer token is missing", () => {
    withEnv("PI_MCP_TEST_MISSING_BEARER_TOKEN", undefined, () => {
      expect(() =>
        parseConfigObject({
          mcpServers: {
            remote: {
              type: "remote",
              url: "https://example.com/mcp",
              auth: "bearer",
              bearerTokenEnv: "PI_MCP_TEST_MISSING_BEARER_TOKEN",
            },
          },
        }),
      ).toThrow(
        /MCP server remote is configured with auth: "bearer", but no bearer token is available\. Set environment variable PI_MCP_TEST_MISSING_BEARER_TOKEN/,
      );
    });
  });

  test("bearer auth deterministically replaces explicit authorization headers", () => {
    const config = parseConfigObject({
      mcpServers: {
        remote: {
          type: "remote",
          url: "https://example.com/mcp",
          headers: {
            Authorization: "Basic old",
            authorization: "Bearer old",
            "X-Test": "yes",
          },
          auth: "bearer",
          bearerToken: "new-token",
        },
        headerOnly: {
          type: "remote",
          url: "https://example.com/header-only",
          headers: {
            Authorization: "Basic preserved",
          },
        },
      },
    });

    const remote = findDefinition(config, "remote");
    const headerOnly = findDefinition(config, "headerOnly");
    if (remote.type !== "remote" || headerOnly.type !== "remote") {
      throw new Error("Expected remote definitions");
    }

    expect(remote.headers).toEqual({
      "X-Test": "yes",
      Authorization: "Bearer new-token",
    });
    expect(headerOnly.headers).toEqual({
      Authorization: "Basic preserved",
    });
  });

  test("parses directTools allowlist arrays only", () => {
    const config = parseConfigObject({
      mcpServers: {
        direct: {
          type: "remote",
          url: "https://example.com/mcp",
          directTools: ["fetch", " search ", "", 3, "fetch"],
        },
        broad: {
          type: "remote",
          url: "https://example.com/broad",
          directTools: true,
        },
      },
    });

    expect(findDefinition(config, "direct").directTools).toEqual([
      "fetch",
      "search",
    ]);
    expect(findDefinition(config, "broad").directTools).toEqual([]);
  });

  test("merges project-local config over user config by server key", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mcp-config-test-"));
    try {
      const userConfigPath = join(root, "user-mcp.json");
      const projectConfigDir = join(root, ".pi");
      await mkdir(projectConfigDir, { recursive: true });

      await writeFile(
        userConfigPath,
        JSON.stringify({
          servers: {
            shared: {
              type: "remote",
              url: "https://example.com/user",
              enabled: true,
            },
            userOnly: {
              type: "local",
              command: "user-command",
              enabled: true,
            },
          },
        }),
      );

      await writeFile(
        join(projectConfigDir, "mcp.json"),
        JSON.stringify({
          mcpServers: {
            shared: {
              url: "https://example.com/project",
              enabled: false,
              outputMode: "muted",
            },
            projectOnly: {
              command: ["project-command", "--serve"],
              enabled: true,
            },
          },
        }),
      );

      const config = await loadMcpConfig({ configPath: userConfigPath, cwd: root });

      expect(config.definitions.map((definition) => definition.key)).toEqual([
        "shared",
        "userOnly",
        "projectOnly",
      ]);

      const shared = findDefinition(config, "shared");
      expect(shared).toMatchObject({
        type: "remote",
        enabled: false,
        outputMode: "muted",
      });
      if (shared.type !== "remote") {
        throw new Error("Expected project override to remain remote");
      }
      expect(shared.url).toBe("https://example.com/project");

      expect(findDefinition(config, "userOnly")).toMatchObject({
        type: "local",
        command: "user-command",
        enabled: true,
      });
      expect(findDefinition(config, "projectOnly")).toMatchObject({
        type: "local",
        command: "project-command",
        args: ["--serve"],
        enabled: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
