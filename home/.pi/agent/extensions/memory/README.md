# Agent Memory extension

A thin Pi client for the Agent Memory service.

The extension does not load or inject memory automatically. Memory enters the conversation only when Pi calls a memory tool.

## Configuration

Pi must start with:

- `PI_MEMORY_SERVICE_URL`: deployed Agent Memory URL
- `PI_MEMORY_SERVICE_TOKEN`: bearer token for the service

`PI_MEMORY_PROJECT_ID` may override the current project identity. Otherwise the extension uses the normalized `origin` remote, then falls back to the local project path.

Project-scoped memory is available only in trusted projects.

## Tools

- `memory_get`: retrieve one record by key
- `memory_list`: browse records by scope and tags
- `memory_search`: full-text search one scope
- `memory_write`: create or completely replace one record
- `memory_append`: append to one record without duplicate retries
- `memory_delete`: permanently delete one record

Write, append, and delete support `expectedVersion` to prevent stale changes. Use `memory_get` first when replacing or deleting an existing record.

Records use stable hierarchical keys such as `user/preferences/shell` or `architecture/storage`.
