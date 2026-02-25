import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const WEBFETCH_TOOL = "webfetch";
const WEBFETCH_CACHE_DIR = join(homedir(), ".cache", "pi-webfetch");
const WEBFETCH_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_FETCH_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 8;
const CURL_TIMEOUT_SECONDS = 30;
const CURL_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 pi-webfetch/1.0";
const INSECURE_TLS_WARNING =
  "Warning: TLS certificate validation failed for this page, so the content was fetched without certificate verification.";
const OUTPUT_EMPTY_MESSAGE = "The fetched page did not contain any readable content.";
const MARKDOWN_WRAPPER_START = "<div>";
const MARKDOWN_WRAPPER_END = "</div>";
const OBJECTIVE_FALLBACK_BLOCKS = 12;
const OBJECTIVE_SELECTED_BLOCKS = 8;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
  "you",
  "your",
]);

type CacheStatus = "hit" | "miss" | "refetched";

type CachedDocument = {
  readonly url: string;
  readonly finalUrl: string;
  readonly fetchedAt: number;
  readonly title: string | null;
  readonly markdown: string;
  readonly insecureTlsFallback: boolean;
};

type FetchDocumentResult = {
  readonly document: CachedDocument;
  readonly cacheStatus: CacheStatus;
};

type WebfetchDetails = {
  readonly url: string;
  readonly finalUrl: string;
  readonly objective: string | null;
  readonly cacheStatus: CacheStatus;
  readonly fetchedAt: number;
  readonly insecureTlsFallback: boolean;
  readonly title: string | null;
};

type ExecResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  readonly killed: boolean;
};

const WebfetchParams = Type.Object({
  url: Type.String({
    description: "The URL of the web page to read.",
  }),
  objective: Type.Optional(
    Type.String({
      description:
        "Research goal for relevant excerpts. If omitted, the full page content is returned as Markdown.",
    }),
  ),
  forceRefetch: Type.Optional(
    Type.Boolean({
      description:
        "Force a live fetch instead of using a cached copy that may be a few days old.",
      default: false,
    }),
  ),
});

const execOptions = (
  signal: AbortSignal | undefined,
): { readonly signal: AbortSignal | undefined; readonly timeout: number } => ({
  signal,
  timeout: (CURL_TIMEOUT_SECONDS + 5) * 1000,
});

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

const cacheKeyForUrl = (url: string): string =>
  createHash("sha256").update(url).digest("hex");

const cachePathForUrl = (url: string): string =>
  join(WEBFETCH_CACHE_DIR, `${cacheKeyForUrl(url)}.json`);

const writeFileAtomic = async (
  targetPath: string,
  content: string,
): Promise<void> => {
  const tempPath = `${targetPath}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, targetPath);
};

const loadCachedDocument = async (
  url: string,
): Promise<CachedDocument | null> => {
  const path = cachePathForUrl(url);

  try {
    const [rawDocument, info] = await Promise.all([
      readFile(path, "utf8"),
      stat(path),
    ]);
    const ageMs = Date.now() - info.mtimeMs;
    if (ageMs > WEBFETCH_CACHE_TTL_MS) {
      return null;
    }

    const parsedDocument: unknown = JSON.parse(rawDocument);
    if (!isRecord(parsedDocument)) {
      return null;
    }

    const { finalUrl, fetchedAt, title, markdown, insecureTlsFallback } = parsedDocument;
    if (
      !isNonEmptyString(finalUrl) ||
      typeof fetchedAt !== "number" ||
      !isNonEmptyString(markdown) ||
      typeof insecureTlsFallback !== "boolean"
    ) {
      return null;
    }

    return {
      url,
      finalUrl,
      fetchedAt,
      title: typeof title === "string" ? title : null,
      markdown,
      insecureTlsFallback,
    };
  } catch {
    return null;
  }
};

const saveCachedDocument = async (document: CachedDocument): Promise<void> => {
  await mkdir(WEBFETCH_CACHE_DIR, { recursive: true });
  await writeFileAtomic(cachePathForUrl(document.url), JSON.stringify(document));
};

const buildCurlArgs = (
  url: string,
  outputPath: string,
  insecure: boolean,
): readonly string[] => {
  const args = [
    "--location",
    "--fail",
    "--silent",
    "--show-error",
    "--compressed",
    "--connect-timeout",
    "15",
    "--max-time",
    String(CURL_TIMEOUT_SECONDS),
    "--max-filesize",
    String(MAX_FETCH_FILE_BYTES),
    "--max-redirs",
    String(MAX_REDIRECTS),
    "--proto",
    "=http,https",
    "--proto-redir",
    "=http,https",
    "--user-agent",
    CURL_USER_AGENT,
    "--output",
    outputPath,
    "--write-out",
    "%{url_effective}",
  ];

  if (insecure) {
    args.push("--insecure");
  }

  args.push(url);
  return args;
};

const isTlsVerificationFailure = (result: ExecResult): boolean => {
  const stderr = result.stderr.toLowerCase();
  return (
    result.code === 60 ||
    stderr.includes("certificate") ||
    stderr.includes("issuer") ||
    stderr.includes("ssl")
  );
};

const extractTitle = (html: string): string | null => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match === null) {
    return null;
  }

  const title = match[1].replace(/\s+/g, " ").trim();
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
  htmlPath: string,
  signal: AbortSignal | undefined,
): Promise<string> => {
  const result = (await pi.exec(
    "pandoc",
    ["--from", "html", "--to", "gfm", "--wrap=none", htmlPath],
    execOptions(signal),
  )) as ExecResult;

  if (result.code !== 0) {
    throw new Error(
      `pandoc failed while converting fetched HTML to Markdown: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }

  const markdown = stripWrapperDiv(result.stdout);
  return markdown.length > 0 ? markdown : OUTPUT_EMPTY_MESSAGE;
};

const tokenizeObjective = (objective: string): readonly string[] => {
  const tokens = objective
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  return Array.from(new Set(tokens));
};

const isHeadingBlock = (block: string): boolean => /^#{1,6}\s/.test(block.trim());

const escapeRegExp = (value: string): string =>
  value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");

const countOccurrences = (text: string, token: string): number => {
  const matches = text.match(new RegExp(`\\b${escapeRegExp(token)}\\b`, "g"));
  return matches?.length ?? 0;
};

const scoreBlock = (block: string, tokens: readonly string[]): number => {
  const lowerBlock = block.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    const occurrences = countOccurrences(lowerBlock, token);
    if (occurrences > 0) {
      score += 2 + occurrences;
    }
  }

  return isHeadingBlock(block) ? score * 0.5 : score;
};

const splitMarkdownBlocks = (markdown: string): readonly string[] =>
  markdown
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

const selectRelevantBlocks = (
  blocks: readonly string[],
  objective: string,
): string => {
  const tokens = tokenizeObjective(objective);
  if (tokens.length === 0) {
    return blocks.slice(0, OBJECTIVE_FALLBACK_BLOCKS).join("\n\n");
  }

  const scoredBlocks = blocks
    .map((block, index) => ({
      index,
      score: scoreBlock(block, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, OBJECTIVE_SELECTED_BLOCKS);

  if (scoredBlocks.length === 0) {
    return [
      `No strongly matching excerpts were found for this objective: ${objective}`,
      blocks.slice(0, OBJECTIVE_FALLBACK_BLOCKS).join("\n\n"),
    ].join("\n\n");
  }

  const selectedIndexes = new Set<number>();
  for (const { index } of scoredBlocks) {
    selectedIndexes.add(index);
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (isHeadingBlock(blocks[cursor])) {
        selectedIndexes.add(cursor);
        break;
      }
      if (!isHeadingBlock(blocks[cursor]) && blocks[cursor].length > 120) {
        break;
      }
    }
  }

  const orderedBlocks = blocks.filter((_block, index) => selectedIndexes.has(index));
  return orderedBlocks.join("\n\n");
};

const renderDocument = (
  document: CachedDocument,
  objective: string | undefined,
): string => {
  const body = isNonEmptyString(objective)
    ? [
        `Relevant excerpts for objective: ${objective.trim()}`,
        selectRelevantBlocks(splitMarkdownBlocks(document.markdown), objective.trim()),
      ].join("\n\n")
    : document.markdown;

  const prelude: string[] = [];
  if (document.insecureTlsFallback) {
    prelude.push(INSECURE_TLS_WARNING);
  }
  if (document.title !== null) {
    prelude.push(`Title: ${document.title}`);
  }
  if (document.finalUrl !== document.url) {
    prelude.push(`Final URL: ${document.finalUrl}`);
  }

  return [...prelude, body].filter((part) => part.trim().length > 0).join("\n\n");
};

const truncateContent = (content: string): string => {
  const truncation = truncateHead(content, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return truncation.content;
  }

  return [
    truncation.content,
    `[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`,
  ].join("\n\n");
};

const fetchDocument = async (
  pi: ExtensionAPI,
  normalizedUrl: string,
  forceRefetch: boolean,
  signal: AbortSignal | undefined,
): Promise<FetchDocumentResult> => {
  if (!forceRefetch) {
    const cachedDocument = await loadCachedDocument(normalizedUrl);
    if (cachedDocument !== null) {
      return {
        document: cachedDocument,
        cacheStatus: "hit",
      };
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), "pi-webfetch-"));
  const htmlPath = join(tempDir, "page.html");

  try {
    const secureResult = (await pi.exec(
      "curl",
      [...buildCurlArgs(normalizedUrl, htmlPath, false)],
      execOptions(signal),
    )) as ExecResult;

    let finalFetchResult = secureResult;
    let insecureTlsFallback = false;

    if (secureResult.code !== 0) {
      if (!isTlsVerificationFailure(secureResult)) {
        throw new Error(
          `Failed to fetch ${normalizedUrl}: ${secureResult.stderr || secureResult.stdout || "unknown error"}`,
        );
      }

      const insecureResult = (await pi.exec(
        "curl",
        [...buildCurlArgs(normalizedUrl, htmlPath, true)],
        execOptions(signal),
      )) as ExecResult;

      if (insecureResult.code !== 0) {
        throw new Error(
          `Failed to fetch ${normalizedUrl} after retrying without TLS verification: ${insecureResult.stderr || insecureResult.stdout || "unknown error"}`,
        );
      }

      finalFetchResult = insecureResult;
      insecureTlsFallback = true;
    }

    const finalUrl = finalFetchResult.stdout.trim() || normalizedUrl;
    await validateUrl(finalUrl);

    const htmlInfo = await stat(htmlPath);
    if (htmlInfo.size > MAX_FETCH_FILE_BYTES) {
      throw new Error(
        `Fetched page exceeded the ${formatSize(MAX_FETCH_FILE_BYTES)} safety limit before conversion.`,
      );
    }

    const [html, markdown] = await Promise.all([
      readFile(htmlPath, "utf8"),
      convertHtmlToMarkdown(pi, htmlPath, signal),
    ]);

    const document: CachedDocument = {
      url: normalizedUrl,
      finalUrl,
      fetchedAt: Date.now(),
      title: extractTitle(html),
      markdown,
      insecureTlsFallback,
    };

    await saveCachedDocument(document);

    return {
      document,
      cacheStatus: forceRefetch ? "refetched" : "miss",
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

export const registerWebfetchTool = (pi: ExtensionAPI): void => {
  try {
    pi.registerTool({
      name: WEBFETCH_TOOL,
      label: "Web Fetch",
      description:
        "Fetch a web page at a given URL but suppress the fetched content in tool output. Returns only an acknowledgement with the URL that was fetched.",
      promptSnippet:
        "Fetch a public web page URL and return only an acknowledgement that includes the fetched URL.",
      promptGuidelines: [
        "Use this tool for public Internet URLs only.",
        "Pass forceRefetch: true when freshness matters, such as release notes, changelogs, or live documentation.",
        "The tool output is intentionally suppressed; it only acknowledges that the URL was called.",
        "Do not use this for localhost or private-network URLs.",
      ],
      parameters: WebfetchParams,

      async execute(_toolCallId, params, signal) {
        const normalizedUrl = (await validateUrl(params.url)).toString();
        const fetchedDocument = await fetchDocument(
          pi,
          normalizedUrl,
          params.forceRefetch ?? false,
          signal,
        );
        void truncateContent(renderDocument(fetchedDocument.document, params.objective));

        const details: WebfetchDetails = {
          url: fetchedDocument.document.url,
          finalUrl: fetchedDocument.document.finalUrl,
          objective: isNonEmptyString(params.objective) ? params.objective.trim() : null,
          cacheStatus: fetchedDocument.cacheStatus,
          fetchedAt: fetchedDocument.document.fetchedAt,
          insecureTlsFallback: fetchedDocument.document.insecureTlsFallback,
          title: fetchedDocument.document.title,
        };

        return {
          content: [
            { type: "text", text: `webfetch called for URL: ${fetchedDocument.document.url}` },
          ],
          details,
        };
      },
    });
  } catch (error) {
    if (!isToolConflictError(error, WEBFETCH_TOOL)) {
      throw error;
    }
  }
};
