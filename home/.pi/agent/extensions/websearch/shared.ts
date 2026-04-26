import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { callExaMcpText, isRecord, truncateToolText } from "../exa/shared.js";

const WEBSEARCH_TOOL = "websearch";
const DEFAULT_NUM_RESULTS = 8;
const DEFAULT_TIMEOUT_MS = 25_000;
const CURRENT_YEAR = new Date().getFullYear();

const WebsearchParams = Type.Object({
  query: Type.String({
    description: "Websearch query",
  }),
  numResults: Type.Optional(
    Type.Integer({
      description: "Number of search results to return (default: 8)",
    }),
  ),
  livecrawl: Type.Optional(
    StringEnum(["fallback", "preferred"] as const, {
      description:
        "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
    }),
  ),
  type: Type.Optional(
    StringEnum(["auto", "fast", "deep"] as const, {
      description:
        "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
    }),
  ),
  contextMaxCharacters: Type.Optional(
    Type.Number({
      description:
        "Maximum characters for context string optimized for LLMs (default: 10000)",
    }),
  ),
});

type WebsearchDetails = {
  readonly query: string;
  readonly numResults: number;
  readonly livecrawl: "fallback" | "preferred";
  readonly type: "auto" | "fast" | "deep";
  readonly contextMaxCharacters: number | null;
  readonly engine: "exa";
  readonly resultCount: number;
  readonly truncated: boolean;
  readonly fullOutputPath: string | null;
};

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

const normalizeInteger = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : fallback;
};

const normalizeOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
};

const countResults = (output: string): number => {
  const matches = output.match(/^URL:\s+/gm);
  return matches === null ? 0 : matches.length;
};

const buildDescription = (): string =>
  [
    "Search the web using Exa AI - performs real-time web searches and can scrape content from specific URLs.",
    "Provides up-to-date information for current events and recent data.",
    "Supports configurable result counts and returns the content from the most relevant websites.",
    `The current year is ${CURRENT_YEAR}. Use this year in searches for recent information or current events.`,
  ].join(" ");

export const registerWebsearchTool = (pi: ExtensionAPI): void => {
  try {
    pi.registerTool({
      name: WEBSEARCH_TOOL,
      label: "Web Search",
      description: buildDescription(),
      promptSnippet:
        "Search the web using Exa AI for up-to-date information beyond the model knowledge cutoff.",
      promptGuidelines: [
        "websearch supports live crawling modes: 'fallback' (backup if cached unavailable) or 'preferred' (prioritize live crawling).",
        "websearch search types are 'auto' (balanced), 'fast' (quick results), and 'deep' (comprehensive search).",
        "Use websearch contextMaxCharacters to control context length for LLM-friendly output when needed.",
        `When using websearch for recent information, include the current year (${CURRENT_YEAR}) in the query.`,
      ],
      parameters: WebsearchParams,

      async execute(_toolCallId, params, signal) {
        const query = params.query.trim();
        if (query.length === 0) {
          throw new Error("websearch query must not be empty.");
        }

        const numResults = normalizeInteger(params.numResults, DEFAULT_NUM_RESULTS);
        const livecrawl = params.livecrawl ?? "fallback";
        const type = params.type ?? "auto";
        const contextMaxCharacters = normalizeOptionalNumber(params.contextMaxCharacters);

        const output = await callExaMcpText({
          toolName: "web_search_exa",
          toolArguments: {
            query,
            type,
            numResults,
            livecrawl,
            contextMaxCharacters,
          },
          timeoutMs: DEFAULT_TIMEOUT_MS,
          signal,
          emptyResponseMessage: "No search results found. Please try a different query.",
          errorLabel: "Search error",
          timeoutMessage: "Search request timed out",
        });

        const truncatedOutput = await truncateToolText(output);
        const details: WebsearchDetails = {
          query,
          numResults,
          livecrawl,
          type,
          contextMaxCharacters: contextMaxCharacters ?? null,
          engine: "exa",
          resultCount: countResults(output),
          truncated: truncatedOutput.truncated,
          fullOutputPath: truncatedOutput.fullOutputPath,
        };

        return {
          content: [{ type: "text", text: truncatedOutput.text }],
          details,
        };
      },
    });
  } catch (error) {
    if (!isToolConflictError(error, WEBSEARCH_TOOL)) {
      throw error;
    }
  }
};
