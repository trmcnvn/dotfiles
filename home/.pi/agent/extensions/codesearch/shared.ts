import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const CODESEARCH_TOOL = "codesearch";
const SEARCH_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 pi-codesearch/1.0";
const SEARCH_TIMEOUT_SECONDS = 30;
const EXA_MCP_ENDPOINT =
  process.env.EXA_MCP_ENDPOINT?.trim() || "https://mcp.exa.ai/mcp";

type ExecResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  readonly killed: boolean;
};

type JsonRecord = Record<string, unknown>;

type CodesearchDetails = {
  readonly query: string;
  readonly tokensNum: number;
  readonly resultCount: number;
  readonly engine: "exa";
  readonly languages: readonly string[];
  readonly repo: string | null;
  readonly path: string | null;
};

const CodesearchParams = Type.Object({
  query: Type.String({
    description:
      "Search query to find relevant code context for APIs, libraries, SDKs, and frameworks.",
  }),
  tokensNum: Type.Optional(
    Type.Integer({
      minimum: 1000,
      maximum: 50000,
      default: 5000,
      description:
        "Number of context tokens to return (1000-50000). Higher values return broader context.",
    }),
  ),
  language: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Optional language hints (legacy compatibility), for example [\"TypeScript\", \"TSX\"].",
    }),
  ),
  repo: Type.Optional(
    Type.String({
      description: "Optional repository hint (legacy compatibility).",
    }),
  ),
  path: Type.Optional(
    Type.String({
      description: "Optional file path hint (legacy compatibility).",
    }),
  ),
  page: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 20,
      default: 1,
      description: "Legacy parameter ignored for Exa MCP mode.",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 10,
      default: 5,
      description: "Legacy hint for concise examples in returned context.",
    }),
  ),
});

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isToolConflictError = (error: unknown, toolName: string): boolean => {
  const message =
    typeof error === "string"
      ? error
      : isRecord(error) && typeof error.message === "string"
        ? error.message
        : error instanceof Error
          ? error.message
          : "";

  return message.includes(`Tool "${toolName}" conflicts`);
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const clampInteger = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.trunc(value);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
};

const normalizeStringList = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  for (const item of value) {
    if (isNonEmptyString(item)) {
      normalized.push(item.trim());
    }
  }

  return Array.from(new Set(normalized));
};

const truncateContent = (content: string): string => {
  const truncation = truncateHead(content, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return truncation.content;
  }

  return [
    truncation.content,
    `[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`,
  ].join("\n\n");
};

const runCurl = async (
  pi: ExtensionAPI,
  args: readonly string[],
  signal: AbortSignal | undefined,
): Promise<string> => {
  const result = (await pi.exec("curl", [...args], {
    signal,
    timeout: (SEARCH_TIMEOUT_SECONDS + 5) * 1000,
  })) as ExecResult;

  if (result.code !== 0) {
    throw new Error(
      `codesearch request failed: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }

  return result.stdout;
};

const parseExaMcpCodesearchText = (responseBody: string): string => {
  const outputChunks: string[] = [];

  for (const line of responseBody.split("\n")) {
    if (!line.startsWith("data:")) {
      continue;
    }

    const payload = line.slice("data:".length).trim();
    if (payload.length === 0 || payload === "[DONE]") {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }

    if (!isRecord(parsed) || !isRecord(parsed.result)) {
      continue;
    }

    const content = Array.isArray(parsed.result.content) ? parsed.result.content : [];
    for (const item of content) {
      if (!isRecord(item) || item.type !== "text" || !isNonEmptyString(item.text)) {
        continue;
      }

      outputChunks.push(item.text.trim());
    }
  }

  if (outputChunks.length === 0) {
    throw new Error("codesearch received an empty response from Exa MCP.");
  }

  return outputChunks.join("\n\n");
};

const countReferencedUrls = (content: string): number => {
  const matches = content.match(/^https?:\/\//gm);
  return matches === null ? 0 : matches.length;
};

const buildEffectiveQuery = (params: {
  readonly query: string;
  readonly limit: number;
  readonly languages: readonly string[];
  readonly repo: string | null;
  readonly path: string | null;
}): string => {
  const hints: string[] = [];

  if (params.languages.length > 0) {
    hints.push(`Prefer examples in these languages: ${params.languages.join(", ")}`);
  }
  if (params.repo !== null) {
    hints.push(`Prefer examples from repository: ${params.repo}`);
  }
  if (params.path !== null) {
    hints.push(`Prefer examples related to path: ${params.path}`);
  }
  if (params.limit !== 5) {
    hints.push(`Aim for approximately ${params.limit} concise, high-signal examples.`);
  }

  if (hints.length === 0) {
    return params.query;
  }

  return [params.query, "", "Additional constraints:", ...hints.map((hint) => `- ${hint}`)].join(
    "\n",
  );
};

export const registerCodesearchTool = (pi: ExtensionAPI): void => {
  try {
    pi.registerTool({
      name: CODESEARCH_TOOL,
      label: "Code Search",
      description:
        "Search and retrieve relevant code context using Exa Code via Exa MCP.",
      promptSnippet:
        "Search for real code examples and API context across libraries, SDKs, and frameworks.",
      promptGuidelines: [
        "Uses Exa MCP get_code_context_exa (no API key required).",
        "Use for programming tasks where examples or API context are needed quickly.",
        "Write specific queries with framework/library names for better relevance.",
        "Use tokensNum to control context breadth (default 5000).",
      ],
      parameters: CodesearchParams,

      async execute(_toolCallId, params, signal) {
        const query = params.query.trim();
        if (query.length === 0) {
          throw new Error("codesearch query must not be empty.");
        }

        const tokensNum = clampInteger(params.tokensNum, 5000, 1000, 50000);
        const limit = clampInteger(params.limit, 5, 1, 10);
        const languages = normalizeStringList(params.language);
        const repo = isNonEmptyString(params.repo) ? params.repo.trim() : null;
        const path = isNonEmptyString(params.path) ? params.path.trim() : null;

        const effectiveQuery = buildEffectiveQuery({
          query,
          limit,
          languages,
          repo,
          path,
        });

        const requestBody = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "get_code_context_exa",
            arguments: {
              query: effectiveQuery,
              tokensNum,
            },
          },
        });

        const responseBody = await runCurl(
          pi,
          [
            "--location",
            "--silent",
            "--show-error",
            "--compressed",
            "--max-time",
            String(SEARCH_TIMEOUT_SECONDS),
            "--request",
            "POST",
            "--header",
            "accept: application/json, text/event-stream",
            "--header",
            "content-type: application/json",
            "--header",
            `user-agent: ${SEARCH_USER_AGENT}`,
            "--data-binary",
            requestBody,
            EXA_MCP_ENDPOINT,
          ],
          signal,
        );

        const output = parseExaMcpCodesearchText(responseBody);
        const content = truncateContent(output);

        const details: CodesearchDetails = {
          query,
          tokensNum,
          resultCount: countReferencedUrls(output),
          engine: "exa",
          languages,
          repo,
          path,
        };

        return {
          content: [{ type: "text", text: content }],
          details,
        };
      },
    });
  } catch (error) {
    if (!isToolConflictError(error, CODESEARCH_TOOL)) {
      throw error;
    }
  }
};
