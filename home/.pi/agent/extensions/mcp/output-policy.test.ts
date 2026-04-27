import { describe, expect, test } from "bun:test";
import {
  exposesRawMcpOutputDetails,
  formatMcpToolErrorMessage,
  formatMcpToolOutput,
} from "./output-policy.js";

const multilineOutput = Array.from({ length: 20 }, (_value, index) =>
  `raw secret line ${index + 1}`,
).join("\n");

describe("MCP outputMode policy", () => {
  test("muted hides raw output on success and error", () => {
    const rawOutput = "token=super-secret";

    expect(formatMcpToolOutput("muted", rawOutput)).toBe(
      "(output hidden by MCP outputMode configuration)",
    );
    expect(formatMcpToolErrorMessage("server", "tool", "muted", rawOutput)).toBe(
      "MCP tool server/tool returned an error. (output hidden by MCP outputMode configuration)",
    );
    expect(formatMcpToolErrorMessage("server", "tool", "muted", rawOutput)).not.toContain(
      "super-secret",
    );
    expect(exposesRawMcpOutputDetails("muted")).toBe(false);
  });

  test("collapsed limits success and error output consistently", () => {
    const successOutput = formatMcpToolOutput("collapsed", multilineOutput);
    const errorMessage = formatMcpToolErrorMessage("server", "tool", "collapsed", multilineOutput);

    expect(successOutput).toContain("raw secret line 1");
    expect(successOutput).toContain("raw secret line 14");
    expect(successOutput).not.toContain("raw secret line 15");
    expect(successOutput).toContain("... 6 more lines");

    expect(errorMessage).toContain(successOutput);
    expect(errorMessage).not.toContain("raw secret line 15");
  });

  test("full mode preserves bounded output text", () => {
    expect(formatMcpToolOutput("full", "complete output")).toBe("complete output");
    expect(formatMcpToolErrorMessage("server", "tool", "full", "complete output")).toBe(
      "MCP tool server/tool returned an error: complete output",
    );
    expect(exposesRawMcpOutputDetails("full")).toBe(true);
  });
});
