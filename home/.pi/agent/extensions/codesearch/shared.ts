import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { callExaMcpText, isRecord } from "../exa/shared.js";

const CODESEARCH_TOOL = "codesearch";
const DEFAULT_TOKENS = 5000;
const MIN_TOKENS = 1000;
const MAX_TOKENS = 50000;
const DEFAULT_TIMEOUT_MS = 30_000;

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
  const matches = content.match(/^https?:\/\//gm);
  return matches === null ? 0 : matches.length;
};

export const registerCodesearchTool = (pi: ExtensionAPI): void => {
  try {
    pi.registerTool({
      name: CODESEARCH_TOOL,
      label: "Code Search",
      description:
        "Search and get relevant context for programming tasks using Exa Code. Returns comprehensive code examples, documentation, and API references.",
      promptSnippet:
        "Search and get relevant programming context using Exa Code for libraries, SDKs, APIs, and frameworks.",
      promptGuidelines: [
        "Use this tool for programming questions and implementation tasks.",
        "Use lower tokensNum values for focused answers and higher values for broader documentation context.",
        "Write specific queries with framework, library, or API names for the best results.",
      ],
      parameters: CodesearchParams,

      async execute(_toolCallId, params, signal) {
        const query = params.query.trim();
        if (query.length === 0) {
          throw new Error("codesearch query must not be empty.");
        }

        const tokensNum = clampTokens(params.tokensNum);

        const output = await callExaMcpText({
          toolName: "get_code_context_exa",
          toolArguments: {
            query,
            tokensNum,
          },
          timeoutMs: DEFAULT_TIMEOUT_MS,
          signal,
          emptyResponseMessage:
            "No code snippets or documentation found. Please try a different query, be more specific about the library or programming concept, or check the spelling of framework names.",
          errorLabel: "Code search error",
          timeoutMessage: "Code search request timed out",
        });

        const details: CodesearchDetails = {
          query,
          tokensNum,
          engine: "exa",
          resultCount: countReferencedUrls(output),
        };

        return {
          content: [{ type: "text", text: output }],
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
