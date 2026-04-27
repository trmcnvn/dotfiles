import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildBatchWebfetchOutput,
  type BatchWebfetchResult,
  type TruncatedBatchWebfetchText,
} from "./batch-output.js";

const createDetails = (url: string, finalUrl = url) => ({
  finalUrl,
  format: "markdown",
});

const passThroughTruncate = async (text: string): Promise<TruncatedBatchWebfetchText> => ({
  text,
  truncated: false,
  fullOutputPath: null,
});

const truncateAfter = (maxLength: number) => async (
  text: string,
): Promise<TruncatedBatchWebfetchText> => {
  if (text.length <= maxLength) {
    return {
      text,
      truncated: false,
      fullOutputPath: null,
    };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "batch-webfetch-test-"));
  const fullOutputPath = join(tempDir, "output.txt");
  await writeFile(fullOutputPath, text, "utf8");

  return {
    text: `${text.slice(0, maxLength)}\n\n[Output truncated. Full output saved to: ${fullOutputPath}]`,
    truncated: true,
    fullOutputPath,
  };
};

describe("batch_webfetch output", () => {
  test("includes ordered page contents and individual errors in LLM-facing text", async () => {
    const results: readonly BatchWebfetchResult[] = [
      {
        index: 0,
        url: "https://first.example",
        ok: true,
        content: "First page body",
        details: createDetails("https://first.example"),
      },
      {
        index: 1,
        url: "https://broken.example",
        ok: false,
        error: "DNS returned no usable addresses.",
      },
      {
        index: 2,
        url: "https://second.example",
        ok: true,
        content: "Second page body",
        details: createDetails("https://second.example", "https://second.example/final"),
      },
    ];

    const output = await buildBatchWebfetchOutput(results, passThroughTruncate);

    expect(output.truncated).toBe(false);
    expect(output.fullOutputPath).toBeNull();
    expect(output.text).toContain("Fetched 2/3 URL(s) successfully (1 failed).");
    expect(output.text).toContain("First page body");
    expect(output.text).toContain("Error: DNS returned no usable addresses.");
    expect(output.text).toContain("Second page body");
    expect(output.text).toContain("Final URL: https://second.example/final");

    const firstPosition = output.text.indexOf("First page body");
    const errorPosition = output.text.indexOf("DNS returned no usable addresses.");
    const secondPosition = output.text.indexOf("Second page body");

    expect(firstPosition).toBeGreaterThan(-1);
    expect(errorPosition).toBeGreaterThan(firstPosition);
    expect(secondPosition).toBeGreaterThan(errorPosition);
  });

  test("returns truncation text and saves the full combined output", async () => {
    const largeContent = Array.from({ length: 300 }, (_value, index) =>
      `large fetched page line ${index}`,
    ).join("\n");
    const results: readonly BatchWebfetchResult[] = [
      {
        index: 0,
        url: "https://large.example",
        ok: true,
        content: largeContent,
        details: createDetails("https://large.example"),
      },
    ];

    const output = await buildBatchWebfetchOutput(results, truncateAfter(200));

    expect(output.truncated).toBe(true);
    expect(output.text).toContain("Output truncated.");
    expect(output.text).toContain("Full output saved to:");

    if (output.fullOutputPath === null) {
      throw new Error("Expected truncated batch output to include a full output path.");
    }

    const fullOutput = await readFile(output.fullOutputPath, "utf8");
    expect(fullOutput).toContain("large fetched page line 299");
  });
});
