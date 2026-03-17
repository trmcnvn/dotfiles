# Subagents Extension Upgrade Plan

## Context

We want to expand `home/.pi/agent/extensions/subagents` in four chosen directions:

1. project-scoped agent discovery
2. richer chain dataflow
3. async/background execution plus a status tool
4. controlled skill support while preserving MCP access

Decisions from the user:
- keep the compact tool UX; **no** TUI, slash-command manager, or agent-management work
- keep `consult_subagent` as the main entrypoint
- for duplicate agent names, **user wins over project**
- do the **full** richer chain pass, including per-step `model` / `skill` overrides
- async/background support should cover **single, parallel, and chain**

Current code findings:
- `agents.ts` only loads `~/.pi/agent/agents` today
- `index.ts` launches child `pi` with `--no-extensions --no-skills --no-prompt-templates --no-themes`, then re-adds only `runtime.ts`
- chain mode is sequential and only substitutes `{previous}`
- there is no async runner or `subagent_status` tool today
- `runtime.ts` already registers MCP support and already keeps `mcp` in the default research tool profile
- persisted internal sessions already exist; new persisted sessions are supported in single/parallel/chain, but resume-by-`sessionId` is only implemented for single mode

## Approach

Extend the current implementation in place, but split new behavior into small helper modules instead of making `index.ts` even larger.

Recommended implementation shape:
- add project + user agent discovery with **user > project** precedence
- keep the current hermetic child runtime model (`--no-extensions`, explicit runtime extension, explicit session dir)
- preserve the existing permission policy / read-only model
- keep MCP access exactly as today through `runtime.ts`
- add skills in a **controlled explicit way**: resolve requested skills in the parent extension, then pass exact `--skill <path>` entries to the child while keeping `--no-skills`

### Skills recommendation

Use **explicit skill resolution + explicit `--skill` paths**, not unrestricted child skill auto-discovery.

Why:
- Pi already supports `--no-skills` together with explicit `--skill <path>` loading
- this lets subagents use normal Pi skills from user/project locations without loading unrelated skills into every child run
- it preserves the current low-overhead, hermetic child environment better than dropping `--no-skills`
- it keeps skill usage auditable and compatible with per-agent / per-step overrides

## Files to modify

Existing files:
- `home/.pi/agent/extensions/subagents/agents.ts`
- `home/.pi/agent/extensions/subagents/index.ts`
- `home/.pi/agent/extensions/subagents/runtime.ts`

Likely new helper files:
- `home/.pi/agent/extensions/subagents/skills.ts` — skill-name resolution and override merging
- `home/.pi/agent/extensions/subagents/chain.ts` — chain variable expansion, artifact-dir handling, read/output instructions
- `home/.pi/agent/extensions/subagents/async.ts` — async launch + status persistence
- `home/.pi/agent/extensions/subagents/async-runner.ts` — detached worker for background runs

## Reuse

Existing code and utilities to build on:

- `home/.pi/agent/extensions/subagents/agents.ts`
  - `loadSubagents()` for markdown parsing and dedupe
  - `buildAvailableSubagentsPrompt()` for parent prompt injection
  - existing frontmatter parsing patterns for `model`, `permission`, `readOnly`, `thinkingLevel`, `temperature`, `textVerbosity`

- `home/.pi/agent/extensions/subagents/index.ts`
  - `createSubagentSessionHandle()`, `loadSubagentSessionHandle()`, `finalizeSubagentSessionHandle()` for isolated persisted sessions
  - `runSingleSubagent()` for child-process execution and streamed updates
  - `mapWithConcurrencyLimit()` for bounded parallelism
  - `truncateAndPersistOutput()` and existing result/detail shaping
  - current mode dispatch for single / parallel / chain

- `home/.pi/agent/extensions/subagents/runtime.ts`
  - `registerMcpExtension(pi)` already gives child sessions MCP access
  - `DEFAULT_RESEARCH_TOOLS` already includes `mcp`
  - `applyRequestedTools()` already enforces policy/read-only filtering in child sessions

- Pi CLI / skills utilities already available in the installed harness:
  - `/home/trmcnvn/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/README.md`
    - documents `--session`, `--session-dir`, `--no-session`, `--skill`, `--no-skills`
  - `/home/trmcnvn/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/skills.md`
    - documents that explicit `--skill <path>` still works with `--no-skills`
  - `/home/trmcnvn/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/dist/index.d.ts`
    - exports `loadSkills` / `loadSkillsFromDir`, so the extension can reuse Pi's existing skill discovery instead of reimplementing it

## Steps

- [ ] Extend subagent discovery in `agents.ts` to search a nearest project `.pi/agents` directory in addition to `~/.pi/agent/agents`.
- [ ] Implement agent merge precedence as **user > project** for same normalized names, and surface source metadata only as needed for debugging/prompt text.
- [ ] Extend subagent frontmatter parsing to support default skills (`skill` / `skills`) alongside the existing model/permission fields.
- [ ] Add a small skill-resolution helper that uses Pi's exported `loadSkills(...)` API with the current `cwd`, then resolves requested skill names to concrete `SKILL.md` paths.
- [ ] Keep child runs on `--no-skills`, but append explicit `--skill <path>` args for resolved skills so only the requested skill set is exposed in each child session.
- [ ] Extend `consult_subagent` parameters:
  - single mode: optional `model`, `skill` / `skills`
  - parallel task items: optional `model`, `skill` / `skills`
  - chain step items: optional `model`, `skill` / `skills`, `output`, `reads`
  - chain mode: optional `chainDir`
  - all modes: optional `async`
- [ ] Preserve current `persist`, `sessionId`, and `outputMode` behavior while layering the new parameters on top.
- [ ] Add chain variable/dataflow support for sequential chains:
  - `{task}` for the original user request
  - `{previous}` for prior-step text output
  - `{chain_dir}` for a shared artifact directory
  - per-step `output` instructions for writing artifacts into `chainDir`
  - per-step `reads` instructions for reading prior artifacts from `chainDir`
- [ ] Keep chain execution sequential; do **not** pull in upstream TUI or chain-management features.
- [ ] Refactor execution helpers out of `index.ts` as needed so the richer chain/task resolution stays readable and testable.
- [ ] Add async/background execution support for **single, parallel, and chain** using a detached runner plus an internal async state directory under `~/.pi/agent/internal/subagents/`.
- [ ] Persist async state in simple files (for example `status.json`, `events.jsonl`, and a final result snapshot) so background runs can be inspected without reopening the parent session.
- [ ] Register a new `subagent_status` tool that looks up a background run by id/path and reports state, mode, progress, timestamps, errors, final output, and any persisted child `sessionId` handles.
- [ ] Ensure async execution reuses the same underlying execution codepaths so sync and async behavior stay aligned.
- [ ] Verify existing persisted-session behavior still works, especially that single-mode resume via `sessionId` is unaffected and that internal subagent state remains outside normal user session history.

## Verification

Because this repo does not currently contain an obvious automated test harness for the extension, plan on manual smoke checks first, then add lightweight coverage only if a practical harness appears during implementation.

Manual verification checklist:
- single sync run with a user-scoped agent still works unchanged
- same-name user + project agents resolve to the **user** definition
- project-only agent is discoverable from a nested working directory via nearest `.pi/agents`
- single run with explicit `model` override uses that model
- single / parallel / chain runs with explicit skill overrides load only the requested skills
- MCP still works in child sessions after the skill changes
- chain run validates `{task}`, `{previous}`, and `{chain_dir}` substitution
- chain step `output` writes an artifact and a later step `reads` consumes it correctly
- chain step `model` / `skill` overrides take effect without breaking persisted sessions
- async single launch returns immediately with a background handle; `subagent_status` reaches a completed state and shows final output
- async parallel launch reports per-task progress/results via `subagent_status`
- async chain launch reports step progress/results via `subagent_status`
- `persist: true` still creates isolated internal session handles, and single-mode `sessionId` resume still works after the refactor
- no new subagent state appears in normal `/resume` or default user session flows