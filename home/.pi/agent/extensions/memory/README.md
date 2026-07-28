# Memory extension

Persistent-memory extension backed by a private GitHub repository. GitHub is authoritative; a permission-restricted local cache keeps reads available during temporary network failures.

## Setup

The default repository is `trmcnvn/pi-memory`. Create it as an initialized private repository before loading the extension:

```sh
gh repo create trmcnvn/pi-memory --private --add-readme --description "Private durable memory for Pi"
```

The extension uses the active GitHub CLI account and refuses to use a public repository. Override the repository with `PI_MEMORY_GITHUB_REPOSITORY=OWNER/REPOSITORY`.

GitHub commit history retains prior revisions. `memory_edit` removes content from the current document but cannot erase it from repository history. Continue to exclude secrets and credentials.

## Storage

```text
global.md
projects/<project-slug>-<identity-hash>.md
```

Project identity uses, in order:

1. `PI_MEMORY_PROJECT_ID`, when set.
2. The normalized `origin` URL from `.git/config`.
3. The canonical local project path as a machine-specific fallback.

Set `PI_MEMORY_PROJECT_ID` for projects without a portable Git remote. The local cache defaults to `~/.pi/agent/memory/cache/`; `PI_MEMORY_DIR` changes its parent directory. Cache writes are atomic and use owner-only permissions.

Each memory document is limited to 40 KiB. Writes start warning at 80% capacity and stop at the limit; reads, searches, deletions, and edits that reduce an over-limit document remain available. Set `PI_MEMORY_MAX_BYTES` to a whole number of bytes greater than or equal to 1,024 to change the limit.

Writes use the GitHub Contents API's blob SHA precondition. Concurrent updates fail instead of silently overwriting another session. GitHub must accept a write before the tool reports success; cache failures are warnings only.

## Legacy migration

After creating the repository, run this in each relevant project:

```text
/memory-migrate all
```

It imports these legacy files only when the corresponding GitHub file does not exist:

```text
~/.pi/agent/memory/MEMORY.md
<project-root>/.agents/MEMORY.md
```

Legacy files remain unchanged after migration.

## Tools

- `memory_read`: read global, project, or all memory
- `memory_search`: keyword-search complete global, project, or all memory
- `memory_write`: append durable global or project memory
- `memory_edit`: correct or remove one exact block

Each write is separated by an HTML comment so multi-paragraph writes remain one searchable entry. The comments are omitted from injected and tool-read memory. Search ranks entries by phrase match, keyword coverage, term rarity, headings, and identifier prefixes.

The extension injects up to 6,000 characters from the beginning and end of each scope. It keeps that context stable between writes for prompt-cache reuse. Use `memory_search` for omitted entries. Run `/memory-refresh` to reload from GitHub.

The storage boundary is isolated in `github-memory-store.ts` so a future Cloudflare-backed adapter can replace it without changing document mutation, search, or prompt-context behavior.
