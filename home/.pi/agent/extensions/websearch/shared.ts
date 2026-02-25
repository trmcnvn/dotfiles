import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const WEBSEARCH_TOOL = "websearch";
const SEARCH_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 pi-websearch/1.0";
const SEARCH_TIMEOUT_SECONDS = 20;

const EXA_SEARCH_ENDPOINT =
  process.env.EXA_SEARCH_ENDPOINT?.trim() || "https://api.exa.ai/search";
const EXA_MCP_ENDPOINT =
  process.env.EXA_MCP_ENDPOINT?.trim() || "https://mcp.exa.ai/mcp";
const EXA_DEFAULT_TEXT_MAX_CHARACTERS = 600;

const DUCKDUCKGO_HTML_ENDPOINT = "https://duckduckgo.com/html/";

type ExecResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  readonly killed: boolean;
};

type JsonRecord = Record<string, unknown>;

type WebResult = {
  readonly title: string;
  readonly url: string;
  readonly snippet: string | null;
};

type WebsearchDetails = {
  readonly query: string;
  readonly limit: number;
  readonly resultCount: number;
  readonly engine: "exa" | "duckduckgo";
  readonly requestId: string | null;
  readonly resolvedSearchType: string | null;
  readonly costDollarsTotal: number | null;
};

type WebsearchToolResult = {
  content: { type: "text"; text: string }[];
  details: WebsearchDetails;
};

type WebsearchDetailsInput = {
  readonly query: string;
  readonly limit: number;
  readonly resultCount: number;
  readonly engine: "exa" | "duckduckgo";
  readonly requestId?: string | null;
  readonly resolvedSearchType?: string | null;
  readonly costDollarsTotal?: number | null;
};

const WebsearchParams = Type.Object({
  query: Type.String({
    description: "Natural-language web query.",
  }),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 10,
      default: 5,
      description: "Max number of results to return (1-10).",
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

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const buildWebsearchDetails = ({
  query,
  limit,
  resultCount,
  engine,
  requestId = null,
  resolvedSearchType = null,
  costDollarsTotal = null,
}: WebsearchDetailsInput): WebsearchDetails => ({
  query,
  limit,
  resultCount,
  engine,
  requestId,
  resolvedSearchType,
  costDollarsTotal,
});

const decodeHtmlEntities = (value: string): string => {
  const namedEntities: Readonly<Record<string, string>> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    }

    if (entity.startsWith("#")) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    }

    return namedEntities[entity] ?? "";
  });
};

const stripHtmlTags = (value: string): string =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");

const htmlToText = (value: string): string =>
  normalizeWhitespace(decodeHtmlEntities(stripHtmlTags(value)));

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
      `curl failed: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }

  return result.stdout;
};

const parseExaErrorMessage = (value: unknown): string => {
  if (!isRecord(value)) {
    return "unknown API error";
  }

  const parts: string[] = [];
  if (isNonEmptyString(value.error)) {
    parts.push(value.error.trim());
  }
  if (isNonEmptyString(value.message)) {
    parts.push(value.message.trim());
  }

  return parts.length > 0 ? parts.join(". ") : "unknown API error";
};

const fetchJson = async (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: string;
  },
  signal: AbortSignal | undefined,
): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_SECONDS * 1000);

  const forwardAbort = () => {
    controller.abort();
  };

  if (signal !== undefined) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  try {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
    });

    const responseText = await response.text();

    let parsedBody: unknown = null;
    if (responseText.trim().length > 0) {
      try {
        parsedBody = JSON.parse(responseText);
      } catch {
        throw new Error("websearch received non-JSON response from Exa.");
      }
    }

    if (!response.ok) {
      throw new Error(
        `Exa websearch request failed with status ${response.status}: ${parseExaErrorMessage(parsedBody)}`,
      );
    }

    return parsedBody;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (signal?.aborted) {
        throw new Error("websearch request was aborted.");
      }
      throw new Error(
        `websearch request timed out after ${SEARCH_TIMEOUT_SECONDS} seconds.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (signal !== undefined) {
      signal.removeEventListener("abort", forwardAbort);
    }
  }
};

const parseWebResultSnippet = (value: unknown): string | null => {
  if (isNonEmptyString(value)) {
    const text = normalizeWhitespace(value);
    return text.length > 0 ? text : null;
  }

  if (Array.isArray(value)) {
    const text = normalizeWhitespace(
      value.filter((item): item is string => isNonEmptyString(item)).join(" "),
    );
    return text.length > 0 ? text : null;
  }

  return null;
};

const parseExaWebResults = (
  response: unknown,
  limit: number,
): {
  readonly results: readonly WebResult[];
  readonly requestId: string | null;
  readonly resolvedSearchType: string | null;
  readonly costDollarsTotal: number | null;
} => {
  if (!isRecord(response)) {
    throw new Error("websearch received an unexpected response shape from Exa.");
  }

  const rawResults = Array.isArray(response.results) ? response.results : [];
  const results: WebResult[] = [];

  for (const rawResult of rawResults) {
    if (!isRecord(rawResult) || !isNonEmptyString(rawResult.url)) {
      continue;
    }

    const url = rawResult.url.trim();
    const title = isNonEmptyString(rawResult.title) ? rawResult.title.trim() : url;

    const snippet =
      parseWebResultSnippet(rawResult.text) ??
      parseWebResultSnippet(rawResult.highlights);

    results.push({ title, url, snippet });

    if (results.length >= limit) {
      break;
    }
  }

  const requestId = isNonEmptyString(response.requestId)
    ? response.requestId.trim()
    : null;

  const resolvedSearchType = isNonEmptyString(response.resolvedSearchType)
    ? response.resolvedSearchType.trim()
    : null;

  let costDollarsTotal: number | null = null;
  if (isRecord(response.costDollars) && typeof response.costDollars.total === "number") {
    const total = response.costDollars.total;
    if (Number.isFinite(total)) {
      costDollarsTotal = total;
    }
  }

  return {
    results,
    requestId,
    resolvedSearchType,
    costDollarsTotal,
  };
};

const parseExaMcpWebsearchText = (responseBody: string): string => {
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
    throw new Error("websearch received an empty response from Exa MCP.");
  }

  return outputChunks.join("\n\n");
};

const countExaMcpResults = (output: string): number => {
  const matches = output.match(/^URL:\s+/gm);
  return matches === null ? 0 : matches.length;
};

const fetchExaMcpWebsearchText = async (
  pi: ExtensionAPI,
  query: string,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<string> => {
  const requestBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "web_search_exa",
      arguments: {
        query,
        numResults: limit,
        type: "auto",
        livecrawl: "fallback",
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
      "--data-binary",
      requestBody,
      EXA_MCP_ENDPOINT,
    ],
    signal,
  );

  return parseExaMcpWebsearchText(responseBody);
};

const decodeDuckDuckGoResultUrl = (href: string): string | null => {
  const trimmed = href.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  if (trimmed.startsWith("/l/?")) {
    const params = new URLSearchParams(trimmed.slice("/l/?".length));
    const target = params.get("uddg");
    if (isNonEmptyString(target)) {
      try {
        return decodeURIComponent(target);
      } catch {
        return target;
      }
    }
  }

  return null;
};

const parseDuckDuckGoSnippet = (snippetHtml: string | undefined): string | null => {
  const parsed = htmlToText(snippetHtml ?? "");
  return parsed.length > 0 ? parsed : null;
};

const parseDuckDuckGoWebResults = (
  responseBody: string,
  limit: number,
): readonly WebResult[] => {
  const results: WebResult[] = [];
  const seenUrls = new Set<string>();

  const resultMatches = responseBody.matchAll(
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  );

  for (const match of resultMatches) {
    const rawHref = match[1] ?? "";
    const url = decodeDuckDuckGoResultUrl(rawHref);
    if (url === null || seenUrls.has(url)) {
      continue;
    }

    const rawTitle = match[2] ?? "";
    const title = htmlToText(rawTitle);
    if (title.length === 0) {
      continue;
    }

    const blockStart = match.index ?? 0;
    const snippetWindow = responseBody.slice(blockStart, blockStart + 1600);

    const snippetMatch =
      snippetWindow.match(
        /<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i,
      ) ?? null;

    const snippet =
      snippetMatch === null ? null : parseDuckDuckGoSnippet(snippetMatch[1]);

    seenUrls.add(url);
    results.push({ title, url, snippet });

    if (results.length >= limit) {
      break;
    }
  }

  return results;
};

const fetchDuckDuckGoWebResults = async (
  pi: ExtensionAPI,
  query: string,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<readonly WebResult[]> => {
  const params = new URLSearchParams();
  params.set("q", query);

  const responseBody = await runCurl(
    pi,
    [
      "--location",
      "--silent",
      "--show-error",
      "--compressed",
      "--max-time",
      String(SEARCH_TIMEOUT_SECONDS),
      "--user-agent",
      SEARCH_USER_AGENT,
      `${DUCKDUCKGO_HTML_ENDPOINT}?${params.toString()}`,
    ],
    signal,
  );

  return parseDuckDuckGoWebResults(responseBody, limit);
};

const renderWebResults = (query: string, results: readonly WebResult[]): string => {
  if (results.length === 0) {
    return `No web results found for query: ${query}`;
  }

  const lines: string[] = [`Top ${results.length} web results for "${query}":`];
  for (const [index, result] of results.entries()) {
    lines.push(`${index + 1}. [${result.title}](${result.url})`);
    if (result.snippet !== null) {
      lines.push(`   ${result.snippet}`);
    }
  }

  return lines.join("\n");
};

const getExaApiKey = (): string | null => {
  const rawKey = process.env.EXA_API_KEY;
  return isNonEmptyString(rawKey) ? rawKey.trim() : null;
};

export const registerWebsearchTool = (pi: ExtensionAPI): void => {
  try {
    pi.registerTool({
      name: WEBSEARCH_TOOL,
      label: "Web Search",
      description:
        "Search the public web with Exa. Uses Exa MCP by default, Exa API when EXA_API_KEY is set, and falls back to DuckDuckGo if MCP fails.",
      promptSnippet: "Search the public web for current information.",
      promptGuidelines: [
        "Primary engine is Exa via Exa MCP (no API key required).",
        "If EXA_API_KEY is set, websearch uses Exa's direct API.",
        "DuckDuckGo is only a fallback when Exa MCP is unavailable.",
        "Use for broad web research when you do not already have a specific URL.",
        "Keep queries specific to improve result quality.",
        "Prefer webfetch when you already know the exact URL to read.",
      ],
      parameters: WebsearchParams,

      async execute(_toolCallId, params, signal): Promise<WebsearchToolResult> {
        const query = params.query.trim();
        if (query.length === 0) {
          throw new Error("websearch query must not be empty.");
        }

        const limit = clampInteger(params.limit, 5, 1, 10);
        const apiKey = getExaApiKey();

        if (apiKey === null) {
          try {
            const mcpOutput = await fetchExaMcpWebsearchText(pi, query, limit, signal);

            return {
              content: [{ type: "text", text: truncateContent(mcpOutput) }],
              details: buildWebsearchDetails({
                query,
                limit,
                resultCount: countExaMcpResults(mcpOutput),
                engine: "exa",
              }),
            };
          } catch {
            const fallbackResults = await fetchDuckDuckGoWebResults(
              pi,
              query,
              limit,
              signal,
            );

            return {
              content: [
                {
                  type: "text",
                  text: truncateContent(renderWebResults(query, fallbackResults)),
                },
              ],
              details: buildWebsearchDetails({
                query,
                limit,
                resultCount: fallbackResults.length,
                engine: "duckduckgo",
              }),
            };
          }
        }

        const requestBody = JSON.stringify({
          query,
          numResults: limit,
          type: "auto",
          useAutoprompt: true,
          contents: {
            text: {
              maxCharacters: EXA_DEFAULT_TEXT_MAX_CHARACTERS,
            },
          },
        });

        const rawResponse = await fetchJson(
          EXA_SEARCH_ENDPOINT,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "user-agent": SEARCH_USER_AGENT,
              "x-api-key": apiKey,
            },
            body: requestBody,
          },
          signal,
        );

        const parsed = parseExaWebResults(rawResponse, limit);

        return {
          content: [
            {
              type: "text",
              text: truncateContent(renderWebResults(query, parsed.results)),
            },
          ],
          details: buildWebsearchDetails({
            query,
            limit,
            resultCount: parsed.results.length,
            engine: "exa",
            requestId: parsed.requestId,
            resolvedSearchType: parsed.resolvedSearchType,
            costDollarsTotal: parsed.costDollarsTotal,
          }),
        };
      },
    });
  } catch (error) {
    if (!isToolConflictError(error, WEBSEARCH_TOOL)) {
      throw error;
    }
  }
};
