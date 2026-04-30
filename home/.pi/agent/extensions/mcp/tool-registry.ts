import type { JsonRecord, McpRegisteredTool, McpServerDefinition, PersistedMcpDiscoveryTool } from "./types.js";
import { resolveToolOutputMode } from "./config.js";
import { isNonEmptyString, isRecord, sanitizeNameToken } from "./utils.js";

export const summarizeInputSchema = (inputSchema: JsonRecord): string | null => {
  const properties = inputSchema.properties;
  if (!isRecord(properties)) {
    return null;
  }

  const requiredSet = new Set<string>(
    Array.isArray(inputSchema.required)
      ? inputSchema.required.filter((value): value is string => typeof value === "string")
      : [],
  );

  const summaries: string[] = [];
  for (const [name, schemaValue] of Object.entries(properties)) {
    if (!isRecord(schemaValue)) {
      continue;
    }

    const fieldType = isNonEmptyString(schemaValue.type)
      ? schemaValue.type
      : "unknown";
    const required = requiredSet.has(name) ? "required" : "optional";
    const description = isNonEmptyString(schemaValue.description)
      ? ` - ${schemaValue.description.trim()}`
      : "";
    summaries.push(`${name} (${fieldType}, ${required})${description}`);

    if (summaries.length >= 4) {
      break;
    }
  }

  if (summaries.length === 0) {
    return null;
  }

  return `Input fields: ${summaries.join("; ")}`;
};

export const createRegisteredTools = (
  definition: McpServerDefinition,
  tools: readonly {
    readonly name: string;
    readonly description: string | null;
    readonly inputSchema: JsonRecord;
  }[],
): readonly McpRegisteredTool[] => {
  const registeredTools: McpRegisteredTool[] = [];
  const seenPiNames = new Set<string>();

  for (const tool of tools) {
    const baseName = `${sanitizeNameToken(definition.key)}_${sanitizeNameToken(tool.name)}`;
    let piToolName = baseName;
    let duplicateIndex = 2;
    while (seenPiNames.has(piToolName)) {
      piToolName = `${baseName}_${duplicateIndex}`;
      duplicateIndex += 1;
    }
    seenPiNames.add(piToolName);

    const inputSummary = summarizeInputSchema(tool.inputSchema);
    const descriptionParts = [
      `MCP tool ${tool.name} from server ${definition.key}.`,
      tool.description ?? "",
      inputSummary ?? "Accepts a JSON object of arguments.",
    ].filter((part) => part.trim().length > 0);

    registeredTools.push({
      mcpToolName: tool.name,
      piToolName,
      description: descriptionParts.join(" "),
      inputSchema: tool.inputSchema,
      outputMode: resolveToolOutputMode(definition, tool.name),
    });
  }

  return registeredTools;
};

export const hydrateRegisteredTools = (
  definition: McpServerDefinition,
  persistedTools: readonly PersistedMcpDiscoveryTool[],
): readonly McpRegisteredTool[] =>
  persistedTools.map((tool) => ({
    mcpToolName: tool.mcpToolName,
    piToolName: tool.piToolName,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputMode: resolveToolOutputMode(definition, tool.mcpToolName),
  }));
