import type { JsonRecord, McpRegisteredTool, McpServerDefinition } from "./types.js";
import { renderUnknownAsText } from "./utils.js";

const formatInputSchemaForText = (inputSchema: JsonRecord): string =>
  renderUnknownAsText(inputSchema);

export const renderProxyStatus = (
  configuredDefinitionsByKey: ReadonlyMap<string, McpServerDefinition>,
  sessionEnabledServers: ReadonlySet<string>,
): string => {
  const lines = ["MCP servers:"];

  for (const serverKey of Array.from(configuredDefinitionsByKey.keys()).sort((a, b) =>
    a.localeCompare(b),
  )) {
    const definition = configuredDefinitionsByKey.get(serverKey);
    const remoteDetails =
      definition !== undefined && definition.type === "remote"
        ? ` · ${definition.transport} · ${definition.timeoutMs}ms`
        : definition !== undefined
          ? ` · ${definition.type}`
          : "";
    lines.push(
      `- ${serverKey} · ${sessionEnabledServers.has(serverKey) ? "enabled" : "disabled"}${remoteDetails}`,
    );
  }

  lines.push("", "Use /mcp to toggle servers for this session.");
  return lines.join("\n");
};

export const renderServerToolList = (
  serverKey: string,
  tools: readonly McpRegisteredTool[],
  configuredDefinitionsByKey: ReadonlyMap<string, McpServerDefinition>,
): string => {
  const definition = configuredDefinitionsByKey.get(serverKey);
  const remoteDetails =
    definition !== undefined && definition.type === "remote"
      ? ` · transport=${definition.transport} · timeout=${definition.timeoutMs}ms${Object.keys(definition.headers).length === 0 ? "" : ` · headers=${Object.keys(definition.headers).length}`}`
      : "";
  const lines = [
    `MCP server ${serverKey}${definition === undefined ? "" : ` (${definition.type})`}${remoteDetails}`,
  ];

  if (tools.length === 0) {
    lines.push("No tools discovered.");
    return lines.join("\n");
  }

  lines.push(
    `${tools.length} tool${tools.length === 1 ? "" : "s"}. Use \`tool\` with the full name below. Use /mcp if this server should be enabled or disabled in this session.`,
    "",
  );

  for (const tool of tools) {
    lines.push(`- ${tool.piToolName}: ${tool.description}`);
  }

  return lines.join("\n");
};

export const renderServerPromptList = (
  serverKey: string,
  prompts: readonly {
    readonly name: string;
    readonly description: string | null;
    readonly argumentsSummary: string | null;
  }[],
): string => {
  const lines = [`MCP prompts from server ${serverKey}`];

  if (prompts.length === 0) {
    lines.push("No prompts discovered.");
    return lines.join("\n");
  }

  lines.push(
    `${prompts.length} prompt${prompts.length === 1 ? "" : "s"}. Use \`getPrompt\` with a prompt name to inspect one.`,
    "",
  );

  for (const prompt of prompts) {
    const description = prompt.description ?? "No description.";
    const argumentSummary =
      prompt.argumentsSummary === null ? "" : ` Arguments: ${prompt.argumentsSummary}.`;
    lines.push(`- ${prompt.name}: ${description}${argumentSummary}`);
  }

  return lines.join("\n");
};

export const renderServerResourceList = (
  serverKey: string,
  resources: readonly {
    readonly name: string;
    readonly uri: string;
    readonly description: string | null;
    readonly mimeType: string | null;
  }[],
): string => {
  const lines = [`MCP resources from server ${serverKey}`];

  if (resources.length === 0) {
    lines.push("No resources discovered.");
    return lines.join("\n");
  }

  lines.push(
    `${resources.length} resource${resources.length === 1 ? "" : "s"}. Use \`readResource\` with a URI to inspect one.`,
    "",
  );

  for (const resource of resources) {
    const metadata = [resource.description, resource.mimeType]
      .filter((part): part is string => part !== null && part.trim().length > 0)
      .join(" · ");
    lines.push(
      `- ${resource.name} (${resource.uri})${metadata.length === 0 ? "" : `: ${metadata}`}`,
    );
  }

  return lines.join("\n");
};

export const renderToolDescription = (serverKey: string, tool: McpRegisteredTool): string => {
  const lines = [
    `Tool: ${tool.piToolName}`,
    `Server: ${serverKey}`,
    `MCP name: ${tool.mcpToolName}`,
    `Description: ${tool.description}`,
    "",
    "Input schema:",
    formatInputSchemaForText(tool.inputSchema),
  ];

  return lines.join("\n");
};

export const renderToolSearch = (
  query: string,
  matches: readonly {
    readonly serverKey: string;
    readonly tool: McpRegisteredTool;
  }[],
  refreshed: boolean,
  autoRefreshed: boolean,
  includeSchemas: boolean,
): string => {
  if (matches.length === 0) {
    if (autoRefreshed) {
      return `No MCP tools matched \"${query}\". Some undiscovered servers may still require auth or a manual refresh; try mcp({ search: \"${query}\", refresh: true }) or inspect a specific server.`;
    }

    return refreshed
      ? `No MCP tools matched \"${query}\".`
      : `No discovered MCP tools matched \"${query}\". Try mcp({ search: \"${query}\", refresh: true }) or list a specific server first.`;
  }

  const lines = [`Found ${matches.length} MCP tool${matches.length === 1 ? "" : "s"} matching \"${query}\":`, ""];
  for (const match of matches.slice(0, 40)) {
    lines.push(`- ${match.tool.piToolName}: ${match.tool.description}`);
    if (includeSchemas) {
      lines.push("  Input schema:");
      for (const schemaLine of formatInputSchemaForText(match.tool.inputSchema).split("\n")) {
        lines.push(`  ${schemaLine}`);
      }
    }
  }

  if (matches.length > 40) {
    lines.push("", `... ${matches.length - 40} more results`);
  }

  return lines.join("\n");
};

