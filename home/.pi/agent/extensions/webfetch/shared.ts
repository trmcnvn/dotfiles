import { Buffer } from "node:buffer";
import { lookup } from "node:dns/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { isRecord } from "../exa/shared.js";

const WEBFETCH_TOOL = "webfetch";
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 1000;
const MAX_TIMEOUT_MS = 120 * 1000;
const MAX_REDIRECTS = 8;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const HONEST_USER_AGENT = "opencode";
const OUTPUT_EMPTY_MESSAGE = "The fetched page did not contain any readable content.";
const MARKDOWN_WRAPPER_START = "<div>";
const MARKDOWN_WRAPPER_END = "</div>";

type ExecResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  readonly killed: boolean;
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
};

const WebfetchParams = Type.Object({
  url: Type.String({
    description: "The URL to fetch content from",
  }),
  format: Type.Optional(
    Type.Union([Type.Literal("text"), Type.Literal("markdown"), Type.Literal("html")], {
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

const isPrivateIpv4 = (hostname: string): boolean => {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match === null) {
    return false;
  }

  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
};

const isPrivateIpv6 = (hostname: string): boolean => {
  const normalizedHostname = hostname.toLowerCase();
  return (
    normalizedHostname === "::1" ||
    normalizedHostname === "::" ||
    normalizedHostname.startsWith("fc") ||
    normalizedHostname.startsWith("fd") ||
    normalizedHostname.startsWith("fe8") ||
    normalizedHostname.startsWith("fe9") ||
    normalizedHostname.startsWith("fea") ||
    normalizedHostname.startsWith("feb")
  );
};

const normalizeHostname = (hostname: string): string =>
  hostname.toLowerCase().replace(/\.+$/, "");

const normalizeResolvedAddress = (address: string): string => {
  const normalizedAddress = address.toLowerCase();
  return normalizedAddress.startsWith("::ffff:")
    ? normalizedAddress.slice("::ffff:".length)
    : normalizedAddress;
};

const isBlockedHostname = (hostname: string): boolean => {
  const normalizedHostname = normalizeHostname(hostname);
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".local") ||
    normalizedHostname.endsWith(".localdomain") ||
    isPrivateIpv4(normalizedHostname) ||
    isPrivateIpv6(normalizedHostname)
  );
};

const validateResolvedAddress = (address: string, url: URL): void => {
  const normalizedAddress = normalizeResolvedAddress(address);
  if (isPrivateIpv4(normalizedAddress) || isPrivateIpv6(normalizedAddress)) {
    throw new Error(
      `Refusing to fetch ${url.toString()} because ${address} resolves to a private-network address.`,
    );
  }
};

const validateUrl = async (value: string): Promise<URL> => {
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

  if (isBlockedHostname(parsedUrl.hostname)) {
    throw new Error(
      `Refusing to fetch ${parsedUrl.toString()} because webfetch is for Internet URLs only, not localhost or private-network addresses.`,
    );
  }

  let resolvedAddresses: readonly { address: string }[];
  try {
    resolvedAddresses = await lookup(parsedUrl.hostname, {
      all: true,
      verbatim: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown DNS error";
    throw new Error(
      `Failed to resolve ${parsedUrl.hostname} before fetching ${parsedUrl.toString()}: ${message}`,
    );
  }

  for (const resolvedAddress of resolvedAddresses) {
    validateResolvedAddress(resolvedAddress.address, parsedUrl);
  }

  return parsedUrl;
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

const stripWrapperDiv = (markdown: string): string => {
  const trimmedMarkdown = markdown.trim();
  if (
    trimmedMarkdown.startsWith(MARKDOWN_WRAPPER_START) &&
    trimmedMarkdown.endsWith(MARKDOWN_WRAPPER_END)
  ) {
    return trimmedMarkdown
      .slice(MARKDOWN_WRAPPER_START.length, -MARKDOWN_WRAPPER_END.length)
      .trim();
  }

  return trimmedMarkdown;
};

const convertHtmlToMarkdown = async (
  pi: ExtensionAPI,
  html: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<string> => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-webfetch-"));
  const htmlPath = join(tempDir, "page.html");

  try {
    await writeFile(htmlPath, html, "utf8");
    const result = (await pi.exec(
      "pandoc",
      ["--from", "html", "--to", "gfm", "--wrap=none", htmlPath],
      {
        signal,
        timeout: timeoutMs + 5000,
      },
    )) as ExecResult;

    if (result.code !== 0) {
      throw new Error(
        `pandoc failed while converting fetched HTML to Markdown: ${result.stderr || result.stdout || "unknown error"}`,
      );
    }

    const markdown = stripWrapperDiv(result.stdout);
    return markdown.length > 0 ? markdown : OUTPUT_EMPTY_MESSAGE;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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

const fetchOnce = async (
  url: string,
  format: WebfetchFormat,
  signal: AbortSignal,
  userAgent: string,
): Promise<Response> => {
  try {
    return await fetch(url, {
      signal,
      redirect: "manual",
      headers: {
        "User-Agent": userAgent,
        Accept: getAcceptHeader(format),
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to fetch ${url}: ${message}`);
  }
};

const fetchWithCloudflareRetry = async (
  url: string,
  format: WebfetchFormat,
  signal: AbortSignal,
): Promise<Response> => {
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
  readonly response: Response;
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
    currentUrl = (await validateUrl(nextUrl)).toString();
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
        "Prefer this tool when you already know the exact URL to retrieve.",
        "Use format: 'markdown' (default), 'text', or 'html' based on the task.",
        "The URL must be a fully formed public Internet http:// or https:// URL.",
        "This tool rejects localhost and private-network targets.",
      ],
      parameters: WebfetchParams,

      async execute(_toolCallId, params, signal) {
        const normalizedUrl = (await validateUrl(params.url)).toString();
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

          const arrayBuffer = await response.arrayBuffer();
          if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
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
            responseBytes: arrayBuffer.byteLength,
            title,
          };

          if (isImageMimeType(mimeType)) {
            return {
              content: [
                { type: "text", text: "Image fetched successfully" },
                {
                  type: "image",
                  data: Buffer.from(arrayBuffer).toString("base64"),
                  mimeType,
                },
              ],
              details,
            };
          }

          const content = new TextDecoder().decode(arrayBuffer);

          switch (format) {
            case "markdown": {
              if (contentType.includes("text/html")) {
                const markdown = await convertHtmlToMarkdown(
                  pi,
                  content,
                  requestSignal,
                  timeoutMs,
                );
                return {
                  content: [{ type: "text", text: markdown }],
                  details: {
                    ...details,
                    title: extractTitle(content) ?? title,
                  },
                };
              }

              return {
                content: [{ type: "text", text: content }],
                details,
              };
            }

            case "text": {
              if (contentType.includes("text/html")) {
                const text = htmlToText(content);
                return {
                  content: [{ type: "text", text: text.length > 0 ? text : OUTPUT_EMPTY_MESSAGE }],
                  details: {
                    ...details,
                    title: extractTitle(content) ?? title,
                  },
                };
              }

              return {
                content: [{ type: "text", text: content }],
                details,
              };
            }

            case "html": {
              return {
                content: [{ type: "text", text: content }],
                details: {
                  ...details,
                  title: contentType.includes("text/html") ? extractTitle(content) ?? title : title,
                },
              };
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
