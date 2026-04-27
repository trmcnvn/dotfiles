import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { callExaMcpText, isRecord, truncateToolText } from "../exa/shared.js";

const CODESEARCH_TOOL = "codesearch";
const DEFAULT_TOKENS = 5000;
const MIN_TOKENS = 1000;
const MAX_TOKENS = 50000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RESULT_COUNT = 8;
const ESTIMATED_CHARACTERS_PER_TOKEN = 4;

const CodesearchParams = Type.Object({
  query: Type.String({
    description:
      "Search query to find relevant context for APIs, Libraries, and SDKs. For example, 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'",
  }),
  tokensNum: Type.Optional(
    Type.Integer({
      minimum: MIN_TOKENS,
      maximum: MAX_TOKENS,
      default: DEFAULT_TOKENS,
      description:
        "Number of tokens to return (1000-50000). Default is 5000 tokens. Adjust this value based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.",
    }),
  ),
});

type CodesearchDetails = {
  readonly query: string;
  readonly tokensNum: number;
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

const clampTokens = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TOKENS;
  }

  const normalized = Math.trunc(value);
  if (normalized < MIN_TOKENS) {
    return MIN_TOKENS;
  }
  if (normalized > MAX_TOKENS) {
    return MAX_TOKENS;
  }
  return normalized;
};

const countReferencedUrls = (content: string): number => {
  const urlLineMatches = content.match(/^URL:\s+\S+/gm);
  if (urlLineMatches !== null) {
    return urlLineMatches.length;
  }

  const bareUrlMatches = content.match(/^https?:\/\//gm);
  return bareUrlMatches === null ? 0 : bareUrlMatches.length;
};

const tokensToContextMaxCharacters = (tokensNum: number): number =>
  tokensNum * ESTIMATED_CHARACTERS_PER_TOKEN;

const buildCodeSearchQuery = (query: string): string =>
  [
    query,
    "Prioritize official documentation, API references, and real code examples.",
  ].join("\n\n");

export const registerCodesearchTool = (pi: ExtensionAPI): void => {
  try {
    pi.registerTool({
      name: CODESEARCH_TOOL,
      label: "Code Search",
      description:
        "Search and get relevant context for programming tasks using Exa. Returns code examples, documentation, and API references.",
      promptSnippet:
        "Search and get relevant programming context using Exa for libraries, SDKs, APIs, and frameworks.",
      promptGuidelines: [
        "Use codesearch for programming questions and implementation tasks.",
        "Use lower codesearch tokensNum values for focused answers and higher values for broader documentation context.",
        "Write specific codesearch queries with framework, library, or API names for the best results.",
      ],
      parameters: CodesearchParams,

      async execute(_toolCallId, params, signal) {
        const query = params.query.trim();
        if (query.length === 0) {
          throw new Error("codesearch query must not be empty.");
        }

        const tokensNum = clampTokens(params.tokensNum);

        const output = await callExaMcpText({
          toolName: "web_search_exa",
          toolArguments: {
            query: buildCodeSearchQuery(query),
            type: "auto",
            numResults: DEFAULT_RESULT_COUNT,
            livecrawl: "fallback",
            contextMaxCharacters: tokensToContextMaxCharacters(tokensNum),
          },
          timeoutMs: DEFAULT_TIMEOUT_MS,
          signal,
          emptyResponseMessage:
            "No code snippets or documentation found. Please try a different query, be more specific about the library or programming concept, or check the spelling of framework names.",
          errorLabel: "Code search error",
          timeoutMessage: "Code search request timed out",
        });

        const truncatedOutput = await truncateToolText(output);
        const details: CodesearchDetails = {
          query,
          tokensNum,
          engine: "exa",
          resultCount: countReferencedUrls(output),
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
    if (!isToolConflictError(error, CODESEARCH_TOOL)) {
      throw error;
    }
  }
};
