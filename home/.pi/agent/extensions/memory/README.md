# Memory extension

Small persistent-memory extension with no Git sync, QMD, daily logs, scratchpad, or todo layer.

## Storage

```text
~/.pi/agent/memory/MEMORY.md   # global
<project-root>/.agents/MEMORY.md
```

Global memory lives under the Pi agent directory. Project memory lives in the nearest `.jj` or `.git` root. Outside a repository, the current working directory is the project root. Pi only reads or writes project memory after the project is trusted.

Set `PI_MEMORY_DIR` to override the global memory directory.

## Tools

- `memory_read`: read global, project, or all memory
- `memory_write`: append durable global or project memory
- `memory_edit`: correct or remove one exact block

The extension injects up to 6,000 characters from the beginning and end of each scope. It keeps that context stable between writes for prompt-cache reuse. Run `/memory-refresh` after editing the files outside Pi.
