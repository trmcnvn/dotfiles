import { Buffer } from "node:buffer";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { isRecord, truncateToolText } from "../exa/shared.js";
import { isBlockedHostname, isNonGlobalAddress, normalizeHostname } from "./address-filter.js";
import { buildBatchWebfetchOutput, type BatchWebfetchResult } from "./batch-output.js";

const WEBFETCH_TOOL = "webfetch";
const BATCH_WEBFETCH_TOOL = "batch_webfetch";
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 1000;
const MAX_TIMEOUT_MS = 120 * 1000;
const MAX_REDIRECTS = 8;
const DEFAULT_BATCH_CONCURRENCY = 4;
const MAX_BATCH_CONCURRENCY = 10;
const MAX_BATCH_REQUESTS = 20;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const HONEST_USER_AGENT = "opencode";
const OUTPUT_EMPTY_MESSAGE = "The fetched page did not contain any readable content.";
type DnsLookupAddress = {
  readonly address: string;
  readonly family: 4 | 6;
};

type HeaderReader = {
  get(name: string): string | null;
};

type WebfetchResponse = {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: HeaderReader;
  readonly body: Buffer;
};

type ValidatedUrl = {
  readonly url: URL;
  readonly address: string;
  readonly family: 4 | 6;
};

type WebfetchFormat = "text" | "markdown" | "html";

type MarkdownProvider = "cloudflare-markdown-for-agents" | "local" | null;

type WebfetchDetails = {
  readonly url: string;
  readonly finalUrl: string;
  readonly format: WebfetchFormat;
  readonly contentType: string;
  readonly mimeType: string | null;
  readonly responseBytes: number;
  readonly title: string | null;
  readonly extractedTitle: string | null;
  readonly canonicalUrl: string | null;
  readonly description: string | null;
  readonly markdownProvider: MarkdownProvider;
  readonly markdownTokens: number | null;
  readonly truncated: boolean;
  readonly fullOutputPath: string | null;
};

const WebfetchParams = Type.Object({
  url: Type.String({
    description: "The URL to fetch content from",
  }),
  format: Type.Optional(
    StringEnum(["text", "markdown", "html"] as const, {
      default: "markdown",
      description:
        "The format to return the content in (text, markdown, or html). Defaults to markdown.",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description: "Optional timeout in seconds (max 120)",
    }),
  ),
});

const BatchWebfetchParams = Type.Object({
  requests: Type.Array(WebfetchParams, {
    minItems: 1,
    maxItems: MAX_BATCH_REQUESTS,
    description: "URLs to fetch. Each request accepts url, format, and timeout.",
  }),
  concurrency: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_BATCH_CONCURRENCY,
      default: DEFAULT_BATCH_CONCURRENCY,
      description: "Maximum concurrent fetches (default 4, max 10).",
    }),
  ),
});

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

const validateResolvedAddress = (address: string, url: URL): void => {
  if (isNonGlobalAddress(address)) {
    throw new Error(
      `Refusing to fetch ${url.toString()} because ${address} resolves to a non-public network address.`,
    );
  }
};

const validateUrl = async (value: string): Promise<ValidatedUrl> => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value.trim());
  } catch {
    throw new Error(`Invalid URL: ${value}. Provide a full http:// or https:// URL.`);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      `Unsupported URL protocol for ${parsedUrl.toString()}. Only http:// and https:// are allowed.`,
    );
  }

  const lookupHostname = normalizeHostname(parsedUrl.hostname);
  if (isBlockedHostname(lookupHostname)) {
    throw new Error(
      `Refusing to fetch ${parsedUrl.toString()} because webfetch is for Internet URLs only, not localhost or private-network addresses.`,
    );
  }

  let resolvedAddresses: readonly DnsLookupAddress[];
  try {
    const lookupResults = await lookup(lookupHostname, {
      all: true,
      verbatim: true,
    });
    resolvedAddresses = lookupResults.filter(
      (resolvedAddress): resolvedAddress is DnsLookupAddress =>
        resolvedAddress.family === 4 || resolvedAddress.family === 6,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown DNS error";
    throw new Error(
      `Failed to resolve ${lookupHostname} before fetching ${parsedUrl.toString()}: ${message}`,
    );
  }

  for (const resolvedAddress of resolvedAddresses) {
    validateResolvedAddress(resolvedAddress.address, parsedUrl);
  }

  const [selectedAddress] = resolvedAddresses;
  if (selectedAddress === undefined) {
    throw new Error(`Failed to resolve ${lookupHostname}: DNS returned no usable addresses.`);
  }

  return {
    url: parsedUrl,
    address: selectedAddress.address,
    family: selectedAddress.family,
  };
};

const normalizeTimeoutMs = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(Math.trunc(value * 1000), MAX_TIMEOUT_MS);
};

const createTimedSignal = (
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

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

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
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<object[\s\S]*?<\/object>/gi, " ")
    .replace(/<embed[\s\S]*?<\/embed>/gi, " ")
    .replace(/<[^>]+>/g, " ");

const htmlToText = (value: string): string =>
  normalizeWhitespace(decodeHtmlEntities(stripHtmlTags(value)));

const extractTitle = (html: string): string | null => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogMatch = html.match(/<meta\b[^>]*property\s*=\s*(["'])og:title\1[^>]*content\s*=\s*(["'])(.*?)\2[^>]*>/i)
    ?? html.match(/<meta\b[^>]*content\s*=\s*(["'])(.*?)\1[^>]*property\s*=\s*(["'])og:title\3[^>]*>/i);
  const raw = ogMatch?.[3] ?? ogMatch?.[2] ?? titleMatch?.[1] ?? "";
  const title = normalizeWhitespace(decodeHtmlEntities(raw));
  return title.length > 0 ? title : null;
};

const extractMetaContent = (html: string, name: string): string | null => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*(["'])${escaped}\\1[^>]*content\\s*=\\s*(["'])(.*?)\\2[^>]*>`, "i"))
    ?? html.match(new RegExp(`<meta\\b[^>]*content\\s*=\\s*(["'])(.*?)\\1[^>]*(?:name|property)\\s*=\\s*(["'])${escaped}\\3[^>]*>`, "i"));
  const raw = match?.[3] ?? match?.[2] ?? "";
  const content = normalizeWhitespace(decodeHtmlEntities(raw));
  return content.length > 0 ? content : null;
};

const extractCanonicalUrl = (html: string, finalUrl: string): string | null => {
  const match = html.match(/<link\b[^>]*rel\s*=\s*(["'])canonical\1[^>]*href\s*=\s*(["'])(.*?)\2[^>]*>/i)
    ?? html.match(/<link\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*rel\s*=\s*(["'])canonical\3[^>]*>/i);
  const raw = match?.[3] ?? match?.[2];
  if (!isNonEmptyString(raw)) return null;
  try {
    return new URL(decodeHtmlEntities(raw).trim(), finalUrl).toString();
  } catch {
    return null;
  }
};

const extractReadableHtml = (html: string): string => {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|iframe|object|embed|svg|canvas|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|aside)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+\b(?:hidden|aria-hidden\s*=\s*(["'])true\1)[^>]*>[\s\S]*?<\/[^>]+>/gi, " ")
    .replace(/<[^>]+\b(?:class|id)\s*=\s*(["'])[^"']*(?:advert|ads|cookie|banner|sidebar|promo|newsletter|social|share|menu)[^"']*\1[^>]*>[\s\S]*?<\/[^>]+>/gi, " ");

  for (const pattern of [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<[^>]+\brole\s*=\s*(["'])main\1[^>]*>([\s\S]*?)<\/[^>]+>/i,
    /<body\b[^>]*>([\s\S]*?)<\/body>/i,
  ]) {
    const match = withoutNoise.match(pattern);
    const content = match?.[2] ?? match?.[1];
    if (isNonEmptyString(content) && htmlToText(content).length > 100) {
      return content;
    }
  }

  return withoutNoise;
};

const htmlPreContentToText = (value: string): string =>
  decodeHtmlEntities(value.replace(/<[^>]+>/g, "")).trim();

const normalizeMarkdown = (value: string): string =>
  decodeHtmlEntities(value)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const convertHtmlToMarkdown = (html: string): string => {
  const readableHtml = extractReadableHtml(html);
  const markdown = readableHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<object[\s\S]*?<\/object>/gi, " ")
    .replace(/<embed[\s\S]*?<\/embed>/gi, " ")
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_match, code) =>
      `\n\n\`\`\`\n${htmlPreContentToText(String(code))}\n\`\`\`\n\n`,
    )
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_match, code) =>
      `\n\n\`\`\`\n${htmlPreContentToText(String(code))}\n\`\`\`\n\n`,
    )
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, inner) => {
      const headingLevel = Number(level);
      const prefix = Number.isInteger(headingLevel) ? "#".repeat(headingLevel) : "#";
      return `\n\n${prefix} ${htmlToText(String(inner))}\n\n`;
    })
    .replace(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_match, _quote, href, inner) => {
      const text = htmlToText(String(inner));
      const url = decodeHtmlEntities(String(href)).trim();
      return text.length === 0 || url.length === 0 ? text : `[${text}](${url})`;
    })
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, inner) =>
      `**${htmlToText(String(inner))}**`,
    )
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, inner) =>
      `_${htmlToText(String(inner))}_`,
    )
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_match, inner) =>
      `\`${htmlToText(String(inner)).replace(/`/g, "\\`")}\``,
    )
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, inner) =>
      `\n- ${htmlToText(String(inner))}`,
    )
    .replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, (_match, inner) => ` ${htmlToText(String(inner))} |`)
    .replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, (_match, inner) => ` ${htmlToText(String(inner))} |`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, inner) =>
      `\n\n> ${htmlToText(String(inner))}\n\n`,
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|main|nav|blockquote|ul|ol|table|tr)>/gi, "\n\n")
    .replace(/<(p|div|section|article|header|footer|main|nav|blockquote|ul|ol|table|tr)[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");

  const normalizedMarkdown = normalizeMarkdown(markdown);
  return normalizedMarkdown.length > 0 ? normalizedMarkdown : OUTPUT_EMPTY_MESSAGE;
};

const getAcceptHeader = (format: WebfetchFormat): string => {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1";
  }
};

const createAbortError = (): Error => {
  const error = new Error("Request aborted.");
  error.name = "AbortError";
  return error;
};

const createHeaderReader = (headers: IncomingHttpHeaders): HeaderReader => ({
  get(name: string): string | null {
    const value = headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    return typeof value === "string" ? value : null;
  },
});

const fetchOnce = async (
  url: string,
  format: WebfetchFormat,
  signal: AbortSignal,
  userAgent: string,
): Promise<WebfetchResponse> => {
  const validated = await validateUrl(url);
  const requestUrl = validated.url;
  const request = requestUrl.protocol === "https:" ? httpsRequest : httpRequest;

  return await new Promise<WebfetchResponse>((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    let settled = false;
    const cleanup = () => {
      signal.removeEventListener("abort", abortRequest);
    };
    const finishReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const finishResolve = (response: WebfetchResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(response);
    };
    const abortRequest = () => {
      clientRequest.destroy(createAbortError());
    };

    const clientRequest = request(
      {
        protocol: requestUrl.protocol,
        hostname: validated.address,
        family: validated.family,
        port: requestUrl.port,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        method: "GET",
        ...(requestUrl.protocol === "https:"
          ? { servername: normalizeHostname(requestUrl.hostname) }
          : {}),
        headers: {
          "User-Agent": userAgent,
          Accept: getAcceptHeader(format),
          "Accept-Language": "en-US,en;q=0.9",
          Host: requestUrl.host,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let responseBytes = 0;

        response.on("data", (chunk: Buffer | string) => {
          if (settled) {
            return;
          }

          const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          responseBytes += chunkBuffer.byteLength;

          if (responseBytes > MAX_RESPONSE_SIZE) {
            finishReject(new Error("Response too large (exceeds 5MB limit)"));
            response.destroy();
            return;
          }

          chunks.push(chunkBuffer);
        });

        response.on("end", () => {
          const status = response.statusCode ?? 0;
          finishResolve({
            status,
            ok: status >= 200 && status < 300,
            headers: createHeaderReader(response.headers),
            body: Buffer.concat(chunks),
          });
        });

        response.on("error", finishReject);
      },
    );

    clientRequest.on("error", finishReject);
    signal.addEventListener("abort", abortRequest, { once: true });
    clientRequest.end();
  }).catch((error: unknown) => {
    if (isAbortError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to fetch ${url}: ${message}`);
  });
};

const fetchWithCloudflareRetry = async (
  url: string,
  format: WebfetchFormat,
  signal: AbortSignal,
): Promise<WebfetchResponse> => {
  const initial = await fetchOnce(url, format, signal, BROWSER_USER_AGENT);

  if (initial.status === 403 && initial.headers.get("cf-mitigated") === "challenge") {
    return fetchOnce(url, format, signal, HONEST_USER_AGENT);
  }

  return initial;
};

const isRedirectStatus = (status: number): boolean =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

const fetchWithRedirects = async (
  initialUrl: string,
  format: WebfetchFormat,
  signal: AbortSignal,
): Promise<{
  readonly response: WebfetchResponse;
  readonly finalUrl: string;
}> => {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchWithCloudflareRetry(currentUrl, format, signal);

    if (!isRedirectStatus(response.status)) {
      return {
        response,
        finalUrl: currentUrl,
      };
    }

    if (redirectCount === MAX_REDIRECTS) {
      throw new Error(
        `Too many redirects while fetching ${initialUrl} (exceeded ${MAX_REDIRECTS}).`,
      );
    }

    const location = response.headers.get("location");
    if (!isNonEmptyString(location)) {
      throw new Error(`Redirect response from ${currentUrl} did not include a Location header.`);
    }

    const nextUrl = new URL(location, currentUrl).toString();
    currentUrl = (await validateUrl(nextUrl)).url.toString();
  }

  throw new Error(`Failed to fetch ${initialUrl}: redirect handling terminated unexpectedly.`);
};

const parseMimeType = (contentType: string): string =>
  contentType.split(";")[0]?.trim().toLowerCase() || "";

const isImageMimeType = (mime: string): boolean =>
  mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet";

type WebfetchInput = {
  readonly url: string;
  readonly format?: WebfetchFormat;
  readonly timeout?: number;
};

type TextContent = { readonly type: "text"; readonly text: string };
type ImageContent = { readonly type: "image"; readonly data: string; readonly mimeType: string };
type WebfetchToolResult = {
  readonly content: readonly (TextContent | ImageContent)[];
  readonly details: WebfetchDetails;
};

const parseMarkdownTokens = (value: string | null): number | null => {
  if (!isNonEmptyString(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const fetchWebContent = async (
  params: WebfetchInput,
  signal: AbortSignal | undefined,
): Promise<WebfetchToolResult> => {
  const normalizedUrl = (await validateUrl(params.url)).url.toString();
  const format = params.format ?? "markdown";
  const timeoutMs = normalizeTimeoutMs(params.timeout);
  const timeoutSeconds = Math.max(1, Math.floor(timeoutMs / 1000));
  const { signal: requestSignal, cleanup } = createTimedSignal(timeoutMs, signal);

  try {
    const { response, finalUrl } = await fetchWithRedirects(normalizedUrl, format, requestSignal);

    if (!response.ok) {
      throw new Error(`Request failed with status code: ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    if (isNonEmptyString(contentLength)) {
      const parsedLength = Number.parseInt(contentLength, 10);
      if (Number.isFinite(parsedLength) && parsedLength > MAX_RESPONSE_SIZE) {
        throw new Error("Response too large (exceeds 5MB limit)");
      }
    }

    const responseBody = response.body;
    if (responseBody.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)");
    }

    const contentType = response.headers.get("content-type") || "";
    const mimeType = parseMimeType(contentType);
    const fallbackTitle = isNonEmptyString(contentType) ? `${normalizedUrl} (${contentType})` : normalizedUrl;
    const markdownTokens = parseMarkdownTokens(response.headers.get("x-markdown-tokens"));

    const details: WebfetchDetails = {
      url: normalizedUrl,
      finalUrl,
      format,
      contentType,
      mimeType: mimeType.length > 0 ? mimeType : null,
      responseBytes: responseBody.byteLength,
      title: fallbackTitle,
      extractedTitle: null,
      canonicalUrl: null,
      description: null,
      markdownProvider: null,
      markdownTokens,
      truncated: false,
      fullOutputPath: null,
    };

    if (isImageMimeType(mimeType)) {
      return {
        content: [
          { type: "text", text: "Image fetched successfully" },
          { type: "image", data: responseBody.toString("base64"), mimeType },
        ],
        details,
      };
    }

    const content = new TextDecoder().decode(responseBody);
    const createTextResponse = async (
      text: string,
      detailOverrides: Partial<WebfetchDetails> = {},
    ): Promise<WebfetchToolResult> => {
      const truncatedText = await truncateToolText(text);
      return {
        content: [{ type: "text", text: truncatedText.text }],
        details: {
          ...details,
          ...detailOverrides,
          truncated: truncatedText.truncated,
          fullOutputPath: truncatedText.fullOutputPath,
        },
      };
    };

    const isHtml = contentType.includes("text/html");
    const isMarkdown = contentType.includes("text/markdown") || contentType.includes("text/x-markdown");
    const extractedTitle = isHtml ? extractTitle(content) : null;
    const htmlDetails = isHtml
      ? {
          title: extractedTitle ?? fallbackTitle,
          extractedTitle,
          canonicalUrl: extractCanonicalUrl(content, finalUrl),
          description: extractMetaContent(content, "description") ?? extractMetaContent(content, "og:description"),
        }
      : {};

    switch (format) {
      case "markdown": {
        if (isMarkdown) {
          return await createTextResponse(content, {
            markdownProvider: "cloudflare-markdown-for-agents",
            markdownTokens,
          });
        }

        if (isHtml) {
          return await createTextResponse(convertHtmlToMarkdown(content), {
            ...htmlDetails,
            markdownProvider: "local",
          });
        }

        return await createTextResponse(content);
      }

      case "text": {
        if (isHtml) {
          const text = htmlToText(extractReadableHtml(content));
          return await createTextResponse(text.length > 0 ? text : OUTPUT_EMPTY_MESSAGE, htmlDetails);
        }

        return await createTextResponse(content);
      }

      case "html": {
        return await createTextResponse(content, htmlDetails);
      }
    }
  } catch (error) {
    if (isAbortError(error)) {
      if (signal?.aborted) {
        throw new Error("Request was aborted.");
      }
      throw new Error(`Request timed out after ${timeoutSeconds} seconds.`);
    }

    throw error;
  } finally {
    cleanup();
  }
};

const normalizeBatchConcurrency = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_BATCH_CONCURRENCY;
  return Math.max(1, Math.min(Math.trunc(value), MAX_BATCH_CONCURRENCY));
};

const runBounded = async <T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runNext = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
  return results;
};

export const registerWebfetchTool = (pi: ExtensionAPI): void => {
  try {
    pi.registerTool({
      name: WEBFETCH_TOOL,
      label: "Web Fetch",
      description:
        "Fetch content from a specified URL, convert to the requested format, and return it directly. Use this when you need to retrieve and analyze web content.",
      promptSnippet:
        "Fetch content from a specific URL and return it as markdown, text, html, or an inline image.",
      promptGuidelines: [
        "Prefer webfetch when you already know the exact URL to retrieve.",
        "Use webfetch format: 'markdown' (default), 'text', or 'html' based on the task.",
        "webfetch URLs must be fully formed public Internet http:// or https:// URLs.",
        "webfetch rejects localhost and private-network targets.",
      ],
      parameters: WebfetchParams,

      async execute(_toolCallId, params, signal) {
        return await fetchWebContent(params, signal);
      },
    });

    pi.registerTool({
      name: BATCH_WEBFETCH_TOOL,
      label: "Batch Web Fetch",
      description:
        "Fetch multiple public web URLs with bounded concurrency. Returns ordered per-request results and preserves individual errors.",
      promptSnippet:
        "Fetch multiple URLs with bounded concurrency and ordered per-request results.",
      promptGuidelines: [
        "Use batch_webfetch when you need to fetch several known URLs at once.",
        "Keep batch_webfetch requests focused; the maximum batch size is 20.",
        "batch_webfetch rejects localhost and private-network targets for every request.",
      ],
      parameters: BatchWebfetchParams,

      async execute(_toolCallId, params, signal) {
        const requests = params.requests.slice(0, MAX_BATCH_REQUESTS);
        const concurrency = normalizeBatchConcurrency(params.concurrency);
        const results = await runBounded<WebfetchInput, BatchWebfetchResult>(requests, concurrency, async (request, index) => {
          try {
            const result = await fetchWebContent(request, signal);
            const textPart = result.content.find((part) => part.type === "text");
            return {
              index,
              url: request.url,
              ok: true as const,
              content: textPart?.type === "text" ? textPart.text : "",
              details: result.details,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              index,
              url: request.url,
              ok: false as const,
              error: message,
            };
          }
        });

        const batchOutput = await buildBatchWebfetchOutput(results, truncateToolText);

        return {
          content: [
            {
              type: "text" as const,
              text: batchOutput.text,
            },
          ],
          details: {
            concurrency,
            results,
            truncated: batchOutput.truncated,
            fullOutputPath: batchOutput.fullOutputPath,
          },
          isError: batchOutput.succeeded === 0,
        };
      },
    });
  } catch (error) {
    if (!isToolConflictError(error, WEBFETCH_TOOL) && !isToolConflictError(error, BATCH_WEBFETCH_TOOL)) {
      throw error;
    }
  }
};
