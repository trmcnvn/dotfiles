import type { McpRegisteredTool } from "./types.js";

export type McpToolSearchMatch = {
  readonly serverKey: string;
  readonly tool: McpRegisteredTool;
};

export type McpToolSearchResult =
  | {
      readonly status: "ok";
      readonly matches: readonly McpToolSearchMatch[];
    }
  | {
      readonly status: "invalid_regex";
      readonly message: string;
    };

const createSearchPredicate = (
  query: string,
  regex: boolean,
):
  | {
      readonly status: "ok";
      readonly matches: (haystack: string) => boolean;
    }
  | {
      readonly status: "invalid_regex";
      readonly message: string;
    } => {
  const trimmedQuery = query.trim();

  if (!regex) {
    const normalizedQuery = trimmedQuery.toLowerCase();
    return {
      status: "ok",
      matches: (haystack: string) => haystack.toLowerCase().includes(normalizedQuery),
    };
  }

  try {
    const pattern = new RegExp(trimmedQuery, "i");
    return {
      status: "ok",
      matches: (haystack: string) => pattern.test(haystack),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "invalid_regex",
      message: `Invalid MCP search regex "${trimmedQuery}": ${message}`,
    };
  }
};

export const findToolMatches = (
  discoveredToolsByServer: ReadonlyMap<string, readonly McpRegisteredTool[]>,
  query: string,
  options: {
    readonly regex: boolean;
    readonly serverKey?: string;
  },
): McpToolSearchResult => {
  const predicate = createSearchPredicate(query, options.regex);
  if (predicate.status === "invalid_regex") {
    return predicate;
  }

  const matches = Array.from(discoveredToolsByServer.entries())
    .filter(
      ([candidateServerKey]) =>
        options.serverKey === undefined || candidateServerKey === options.serverKey,
    )
    .flatMap(([candidateServerKey, tools]) =>
      tools
        .filter((tool) => {
          const haystack = `${tool.piToolName}\n${tool.mcpToolName}\n${tool.description}`;
          return predicate.matches(haystack);
        })
        .map((tool) => ({ serverKey: candidateServerKey, tool })),
    )
    .sort((left, right) => left.tool.piToolName.localeCompare(right.tool.piToolName));

  return {
    status: "ok",
    matches,
  };
};
