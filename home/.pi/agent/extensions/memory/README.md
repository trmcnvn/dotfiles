# Memory extension

Small persistent-memory extension with no Git sync, QMD, daily logs, scratchpad, or todo layer.

## Storage

```text
~/.pi/agent/memory/MEMORY.md   # global
<project-root>/.agents/MEMORY.md
```

Global memory lives under the Pi agent directory. Project memory lives in the nearest `.jj` or `.git` root. Outside a repository, the current working directory is the project root. Pi only reads or writes project memory after the project is trusted.

Set `PI_MEMORY_DIR` to override the global memory directory.

Each file is limited to 40 KiB. Writes start warning at 80% capacity and stop at the limit; reads, searches, deletions, and edits that reduce an over-limit file remain available. Set `PI_MEMORY_MAX_BYTES` to a whole number of bytes greater than or equal to 1,024 to change the limit.

## Tools

- `memory_read`: read global, project, or all memory
- `memory_search`: keyword-search complete global, project, or all memory
- `memory_write`: append durable global or project memory
- `memory_edit`: correct or remove one exact block

Each write is separated by an HTML comment so multi-paragraph writes remain one searchable entry. The comments are omitted from injected and tool-read memory. Search scans the Markdown files directly and ranks entries by phrase match, keyword coverage, term rarity, headings, and identifier prefixes. It requires no index or background process.

The extension injects up to 6,000 characters from the beginning and end of each scope. It keeps that context stable between writes for prompt-cache reuse. Use `memory_search` for entries omitted from the injected context. Run `/memory-refresh` after editing the files outside Pi.
