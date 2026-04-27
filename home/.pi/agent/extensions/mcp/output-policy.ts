export type McpToolOutputMode = "full" | "collapsed" | "muted";

const MCP_COLLAPSED_PREVIEW_LINES = 14;
const MUTED_OUTPUT_MESSAGE = "(output hidden by MCP outputMode configuration)";

const countLines = (value: string): number => {
  if (value.length === 0) {
    return 0;
  }

  return value.split("\n").length;
};

const takePreviewLines = (
  value: string,
  lineLimit: number,
): {
  readonly preview: string;
  readonly omittedLineCount: number;
} => {
  if (lineLimit <= 0 || value.length === 0) {
    return {
      preview: "",
      omittedLineCount: countLines(value),
    };
  }

  const lines = value.split("\n");
  if (lines.length <= lineLimit) {
    return {
      preview: value,
      omittedLineCount: 0,
    };
  }

  return {
    preview: lines.slice(0, lineLimit).join("\n"),
    omittedLineCount: lines.length - lineLimit,
  };
};

export const formatMcpToolOutput = (
  outputMode: McpToolOutputMode,
  output: string,
): string => {
  if (outputMode === "muted") {
    return MUTED_OUTPUT_MESSAGE;
  }

  if (outputMode === "collapsed") {
    const { preview, omittedLineCount } = takePreviewLines(
      output,
      MCP_COLLAPSED_PREVIEW_LINES,
    );

    if (omittedLineCount === 0) {
      return preview;
    }

    return `${preview}\n... ${omittedLineCount} more lines`;
  }

  return output;
};

export const formatMcpToolErrorMessage = (
  serverKey: string,
  toolName: string,
  outputMode: McpToolOutputMode,
  output: string,
): string => {
  const toolLabel = `${serverKey}/${toolName}`;
  if (outputMode === "muted") {
    return `MCP tool ${toolLabel} returned an error. ${MUTED_OUTPUT_MESSAGE}`;
  }

  return `MCP tool ${toolLabel} returned an error: ${formatMcpToolOutput(outputMode, output)}`;
};

export const exposesRawMcpOutputDetails = (outputMode: McpToolOutputMode): boolean =>
  outputMode !== "muted";
