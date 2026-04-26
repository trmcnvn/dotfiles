import { Buffer } from "node:buffer";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { isRecord, truncateToolText } from "../exa/shared.js";

const WEBFETCH_TOOL = "webfetch";
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 1000;
const MAX_TIMEOUT_MS = 120 * 1000;
const MAX_REDIRECTS = 8;
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

type WebfetchDetails = {
  readonly url: string;
  readonly finalUrl: string;
  readonly format: WebfetchFormat;
  readonly contentType: string;
  readonly mimeType: string | null;
  readonly responseBytes: number;
  readonly title: string | null;
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

const normalizeHostname = (hostname: string): string => {
  const normalized = hostname.trim().toLowerCase().replace(/\.+$/, "");
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
};

const normalizeResolvedAddress = (address: string): string => {
  const normalizedAddress = normalizeHostname(address);
  return normalizedAddress.startsWith("::ffff:")
    ? normalizedAddress.slice("::ffff:".length)
    : normalizedAddress;
};

const parseIpv4Octets = (address: string): readonly [number, number, number, number] | null => {
  const match = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match === null) {
    return null;
  }

  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  const [first, second, third, fourth] = octets;
  return first === undefined || second === undefined || third === undefined || fourth === undefined
    ? null
    : [first, second, third, fourth];
};

const isNonGlobalIpv4 = (address: string): boolean => {
  const octets = parseIpv4Octets(address);
  if (octets === null) {
    return false;
  }

  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
};

const isNonGlobalIpv6 = (address: string): boolean => {
  const normalizedAddress = normalizeResolvedAddress(address);
  if (isIP(normalizedAddress) !== 6) {
    return false;
  }

  return (
    normalizedAddress === "::" ||
    normalizedAddress === "::1" ||
    normalizedAddress.startsWith("fc") ||
    normalizedAddress.startsWith("fd") ||
    normalizedAddress.startsWith("fe8") ||
    normalizedAddress.startsWith("fe9") ||
    normalizedAddress.startsWith("fea") ||
    normalizedAddress.startsWith("feb") ||
    normalizedAddress.startsWith("ff") ||
    normalizedAddress.startsWith("100:") ||
    normalizedAddress.startsWith("2001:2:") ||
    normalizedAddress.startsWith("2001:db8") ||
    normalizedAddress.startsWith("2001:0db8")
  );
};

const isNonGlobalAddress = (address: string): boolean => {
  const normalizedAddress = normalizeResolvedAddress(address);
  return isNonGlobalIpv4(normalizedAddress) || isNonGlobalIpv6(normalizedAddress);
};

const isBlockedHostname = (hostname: string): boolean => {
  const normalizedHostname = normalizeHostname(hostname);
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".local") ||
    normalizedHostname.endsWith(".localdomain") ||
    isNonGlobalAddress(normalizedHostname)
  );
};

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
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match === null) {
    return null;
  }

  const title = normalizeWhitespace(decodeHtmlEntities(match[1] ?? ""));
  return title.length > 0 ? title : null;
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
  const markdown = html
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
        const normalizedUrl = (await validateUrl(params.url)).url.toString();
        const format = params.format ?? "markdown";
        const timeoutMs = normalizeTimeoutMs(params.timeout);
        const timeoutSeconds = Math.max(1, Math.floor(timeoutMs / 1000));
        const { signal: requestSignal, cleanup } = createTimedSignal(timeoutMs, signal);

        try {
          const { response, finalUrl } = await fetchWithRedirects(
            normalizedUrl,
            format,
            requestSignal,
          );

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
          const title = isNonEmptyString(contentType)
            ? `${normalizedUrl} (${contentType})`
            : normalizedUrl;

          const details: WebfetchDetails = {
            url: normalizedUrl,
            finalUrl,
            format,
            contentType,
            mimeType: mimeType.length > 0 ? mimeType : null,
            responseBytes: responseBody.byteLength,
            title,
            truncated: false,
            fullOutputPath: null,
          };

          if (isImageMimeType(mimeType)) {
            return {
              content: [
                { type: "text", text: "Image fetched successfully" },
                {
                  type: "image",
                  data: responseBody.toString("base64"),
                  mimeType,
                },
              ],
              details,
            };
          }

          const content = new TextDecoder().decode(responseBody);
          const createTextResponse = async (
            text: string,
            detailOverrides: Partial<WebfetchDetails> = {},
          ) => {
            const truncatedText = await truncateToolText(text);
            return {
              content: [{ type: "text" as const, text: truncatedText.text }],
              details: {
                ...details,
                ...detailOverrides,
                truncated: truncatedText.truncated,
                fullOutputPath: truncatedText.fullOutputPath,
              },
            };
          };

          switch (format) {
            case "markdown": {
              if (contentType.includes("text/html")) {
                const markdown = convertHtmlToMarkdown(content);
                return await createTextResponse(markdown, {
                  title: extractTitle(content) ?? title,
                });
              }

              return await createTextResponse(content);
            }

            case "text": {
              if (contentType.includes("text/html")) {
                const text = htmlToText(content);
                return await createTextResponse(text.length > 0 ? text : OUTPUT_EMPTY_MESSAGE, {
                  title: extractTitle(content) ?? title,
                });
              }

              return await createTextResponse(content);
            }

            case "html": {
              return await createTextResponse(content, {
                title: contentType.includes("text/html") ? extractTitle(content) ?? title : title,
              });
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
      },
    });
  } catch (error) {
    if (!isToolConflictError(error, WEBFETCH_TOOL)) {
      throw error;
    }
  }
};
