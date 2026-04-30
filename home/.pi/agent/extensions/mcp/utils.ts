import type { JsonRecord } from "./types.js";

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const renderUnknownAsText = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (!isRecord(value)) {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? "undefined" : serialized;
  }

  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
};

export const sanitizeNameToken = (value: string): string => {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized.length > 0 ? sanitized : "mcp";
};

export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> => {
  if (signal?.aborted === true) {
    throw new Error(`${label} was cancelled.`);
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  const abortPromise = new Promise<never>((_, reject) => {
    if (signal === undefined) {
      return;
    }

    abortHandler = () => {
      reject(new Error(`${label} was cancelled.`));
    };
    signal.addEventListener("abort", abortHandler, { once: true });
  });

  try {
    return await Promise.race([promise, timeoutPromise, abortPromise]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    if (signal !== undefined && abortHandler !== null) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
};

export const parseAuthorizationCodeInput = (input: string): string | null => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const callbackUrl = new URL(trimmed);
      const code = callbackUrl.searchParams.get("code");
      if (isNonEmptyString(code)) {
        return code;
      }
    } catch {
      // fall through and treat as raw code
    }
  }

  return trimmed;
};

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>\"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
