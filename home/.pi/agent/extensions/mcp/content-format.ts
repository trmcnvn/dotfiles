import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@mariozechner/pi-coding-agent";
import type { JsonRecord, TruncateContentResult } from "./types.js";
import { isNonEmptyString, isRecord, renderUnknownAsText } from "./utils.js";

export const truncateContent = async (content: string): Promise<TruncateContentResult> => {
  const truncation = truncateHead(content, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return {
      text: truncation.content,
      truncated: false,
      fullOutputPath: null,
    };
  }

  const omittedLines = truncation.totalLines - truncation.outputLines;
  const omittedBytes = truncation.totalBytes - truncation.outputBytes;

  let fullOutputPath: string | null = null;
  try {
    const tempDir = await mkdtemp(join(tmpdir(), "pi-mcp-tool-"));
    fullOutputPath = join(tempDir, "output.txt");
    await writeFile(fullOutputPath, content, "utf8");
  } catch {
    fullOutputPath = null;
  }

  const truncationNoticeParts = [
    `Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`,
    `${omittedLines} lines (${formatSize(omittedBytes)}) omitted.`,
    fullOutputPath === null
      ? "Could not persist full output to a temp file."
      : `Full output saved to: ${fullOutputPath}`,
  ];

  return {
    text: [truncation.content, `[${truncationNoticeParts.join(" ")}]`].join("\n\n"),
    truncated: true,
    fullOutputPath,
  };
};

export const coerceStringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }

  const coerced: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isNonEmptyString(key)) {
      continue;
    }

    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      coerced[key.trim()] = String(item);
    }
  }

  return coerced;
};

export const formatPromptMessages = (value: unknown): string => {
  if (!Array.isArray(value) || value.length === 0) {
    return "Prompt returned no messages.";
  }

  const parts: string[] = [];
  for (const [index, message] of value.entries()) {
    if (!isRecord(message) || !isNonEmptyString(message.role)) {
      parts.push(`[${index + 1}] ${renderUnknownAsText(message)}`);
      continue;
    }

    const content = message.content;
    if (isRecord(content) && content.type === "text" && typeof content.text === "string") {
      parts.push(`[${index + 1}] ${message.role}:\n${content.text}`);
      continue;
    }

    parts.push(`[${index + 1}] ${message.role}:\n${renderUnknownAsText(content)}`);
  }

  return parts.join("\n\n");
};

export const formatReadResourceResult = (value: unknown): string => {
  if (!isRecord(value) || !Array.isArray(value.contents) || value.contents.length === 0) {
    return "Resource returned no contents.";
  }

  const parts: string[] = [];
  for (const content of value.contents) {
    if (!isRecord(content) || !isNonEmptyString(content.uri)) {
      parts.push(renderUnknownAsText(content));
      continue;
    }

    const header = [
      `URI: ${content.uri}`,
      typeof content.mimeType === "string" ? `Type: ${content.mimeType}` : null,
    ]
      .filter((part): part is string => part !== null)
      .join("\n");

    if (typeof content.text === "string") {
      parts.push(`${header}\n\n${content.text}`);
      continue;
    }

    if (typeof content.blob === "string") {
      parts.push(`${header}\n\nBinary content omitted (${content.blob.length} base64 chars).`);
      continue;
    }

    parts.push(`${header}\n\n${renderUnknownAsText(content)}`);
  }

  return parts.join("\n\n");
};

export const createProxyTextResult = async (
  text: string,
  details: JsonRecord,
) => {
  const output = await truncateContent(text);
  return {
    content: [{ type: "text" as const, text: output.text }],
    details: {
      ...details,
      truncated: output.truncated,
      fullOutputPath: output.fullOutputPath,
    },
  };
};

export const formatToolContent = (content: unknown): string => {
  if (!Array.isArray(content) || content.length === 0) {
    return "MCP tool returned no content.";
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!isRecord(item) || !isNonEmptyString(item.type)) {
      parts.push(renderUnknownAsText(item));
      continue;
    }

    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
      continue;
    }

    if (item.type === "resource_link") {
      const name = isNonEmptyString(item.name) ? item.name : "resource";
      const uri = isNonEmptyString(item.uri) ? item.uri : "(unknown uri)";
      parts.push(`Resource link: ${name} (${uri})`);
      continue;
    }

    if (item.type === "resource" && isRecord(item.resource)) {
      const uri = isNonEmptyString(item.resource.uri)
        ? item.resource.uri
        : "(unknown uri)";
      if (typeof item.resource.text === "string") {
        parts.push(`Resource: ${uri}\n${item.resource.text}`);
      } else {
        parts.push(`Resource: ${uri} (binary content omitted)`);
      }
      continue;
    }

    if (item.type === "image") {
      const mimeType = isNonEmptyString(item.mimeType) ? item.mimeType : "unknown";
      parts.push(`Image content omitted (${mimeType}).`);
      continue;
    }

    if (item.type === "audio") {
      const mimeType = isNonEmptyString(item.mimeType) ? item.mimeType : "unknown";
      parts.push(`Audio content omitted (${mimeType}).`);
      continue;
    }

    parts.push(renderUnknownAsText(item));
  }

  return parts.join("\n\n");
};

