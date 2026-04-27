{
  "id": "0ebe4cc4",
  "title": "Improve Pi webfetch extension",
  "tags": [
    "pi",
    "extension",
    "webfetch"
  ],
  "status": "closed",
  "created_at": "2026-04-27T06:42:31.579Z"
}

Implemented:

- Added `batch_webfetch` with bounded concurrency, max 20 requests, ordered results, and per-item errors.
- Refactored single fetch path into reusable `fetchWebContent`.
- Added opportunistic Cloudflare Markdown for Agents support via markdown Accept header and `text/markdown` passthrough.
- Added markdown details: `markdownProvider`, `markdownTokens`.
- Added richer HTML metadata details: `extractedTitle`, `canonicalUrl`, `description`.
- Improved local HTML cleanup before markdown/text conversion by stripping common noisy nodes and preferring `main`, `article`, `[role=main]`, then `body`.
- Preserved existing SSRF/private-network checks and redirect validation.

Validation:
- Imported extension successfully with Bun.
- Registered tools successfully: `webfetch`, `batch_webfetch`.
- Live-tested Cloudflare Markdown for Agents against Cloudflare docs; returned `markdownProvider: cloudflare-markdown-for-agents` and `x-markdown-tokens`.
- Live-tested `batch_webfetch` ordering and per-item localhost rejection.

Not done:
- No formal unit test harness added.
- No external DOM parser dependency added; local HTML cleanup remains lightweight regex/heuristic based.
