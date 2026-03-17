type JsonRecord = Record<string, unknown>;

const DEFAULT_EXA_MCP_ENDPOINT =
  process.env.EXA_MCP_ENDPOINT?.trim() || "https://mcp.exa.ai/mcp";

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const buildAbortSignal = (
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
): {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
} => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const forwardAbort = () => {
    controller.abort();
  };

  if (parentSignal !== undefined) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      if (parentSignal !== undefined) {
        parentSignal.removeEventListener("abort", forwardAbort);
      }
    },
  };
};

const extractFirstTextFromSse = (
  responseText: string,
  emptyResponseMessage: string,
): string => {
  for (const line of responseText.split("\n")) {
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

      return item.text;
    }
  }

  throw new Error(emptyResponseMessage);
};

export const callExaMcpText = async (options: {
  readonly toolName: string;
  readonly toolArguments: Record<string, unknown>;
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
  readonly emptyResponseMessage: string;
  readonly errorLabel: string;
  readonly timeoutMessage: string;
  readonly endpoint?: string;
  readonly userAgent?: string;
}): Promise<string> => {
  const {
    toolName,
    toolArguments,
    timeoutMs,
    signal,
    emptyResponseMessage,
    errorLabel,
    timeoutMessage,
    endpoint = DEFAULT_EXA_MCP_ENDPOINT,
    userAgent,
  } = options;

  const { signal: requestSignal, cleanup } = buildAbortSignal(timeoutMs, signal);

  try {
    const headers: Record<string, string> = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    };

    if (isNonEmptyString(userAgent)) {
      headers["user-agent"] = userAgent;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: toolArguments,
        },
      }),
      signal: requestSignal,
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `${errorLabel} (${response.status}): ${responseText || "unknown error"}`,
      );
    }

    return extractFirstTextFromSse(responseText, emptyResponseMessage);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (signal?.aborted) {
        throw new Error("Request was aborted.");
      }
      throw new Error(timeoutMessage);
    }

    throw error;
  } finally {
    cleanup();
  }
};
