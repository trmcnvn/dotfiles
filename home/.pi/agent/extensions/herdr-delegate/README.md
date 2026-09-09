# Herdr Delegate

A user-global Pi extension that exposes one `delegate` tool for a small, sequential build/review workflow in visible Herdr panes.

## Use

Start a normal Pi session (its default model is unchanged), then run:

```text
/skill:orchestrate <implementation task>
```

Pi may also load the orchestration skill for an ordinary matching implementation request. The extension has no startup spawn and no keyword trigger.

The tool catalog lists the two roles from their global files:

- `~/.pi/agent/agents/builder.md`
- `~/.pi/agent/agents/reviewer.md`

A new task uses `role` plus `task`. A successful builder result includes an opaque `worker` id; use `worker` plus `task` for necessary fixes in that same builder session. Reviewer reuse is rejected so every review is fresh. Calls are serialized.

Role frontmatter is editable configuration. `model` must be `provider/id`; `thinking` and every tool are passed exactly to native Pi arguments. The extension validates authentication, tool availability, and whether the exact model supports the requested thinking level before splitting, and never silently falls back. A canonical role fingerprint prevents follow-ups after the role changes. Child Pi sessions keep normal repository context and skills, except that the `delegate` tool is absent and the `orchestrate` skill is removed from their model catalog and blocked as a skill command.

## Runtime and results

Herdr owns pane splitting, Pi startup, lifecycle waits, and pane identity. The extension never starts tmux or a raw child Pi subprocess. It preserves the caller cwd and focus and chooses right/down from caller geometry. Each role body is written with mode `0600` to the worker's private artifact directory and its absolute path is passed to `--append-system-prompt`; multiline role text is never placed in the launch argv.

A child reporter recognizes a private task envelope before model input. At Pi's `agent_settled` boundary it atomically writes a task-id/worker-id-correlated JSON result under:

```text
~/.pi/agent/herdr-delegate-runs/<worker>/<task>.json
```

The file records final output, error/abort/incomplete state, native session, model, thinking, and completion time. Only a `stop` response is completed; length, tool-use, and other unfinished responses are incomplete. Model-visible output is capped at Pi's 50 KB/2,000-line limits; the complete result remains at the reported artifact path. Screen text and idle state are never treated as the answer.

Timeout, stalled, blocked, killed, malformed, and cancelled prompt transports may already have delivered input. Pending task identity is persisted before submission. The extension never resubmits; after confirming the pinned native session it may send Escape, but it retains a recoverable lock unless a matching terminal result or successful closure of that exact owned pane proves safety. Run `/delegate-cleanup` after inspecting the reported pane to close only pinned workers and clear the lock. Reusable builders must be idle before prompting.

Worker identity, launch fingerprint, pending task, parent Pi session ID, and unsafe-writer lock are stored in Pi custom entries and restored across `/reload`. A fork that copied entries refuses to adopt or clean the original session's workers. On non-reload session shutdown, cleanup closes only panes whose agent name, pane, and native session all match. Ambiguous startup panes are left inspectable rather than closed.

The reviewer has `bash` for read-only inspection. Its role policy forbids write-producing commands, but this is not a security sandbox: shell access can technically write.

## Limitations

- Herdr 0.9.0 and its current Pi lifecycle integration are required (`HERDR_ENV=1`). There is no hidden-worker fallback.
- State is scoped to the current Pi session branch. Do not manually rename, move, replace, or close owned workers while delegating.
- v1 has exactly two global roles, one writer, sequential tasks, and one normal review/fix cycle. It has no project role overrides, parallel batches, inheritance, or extra roles.
- The model/tool availability check uses the current parent Pi catalog. Authentication or provider startup can still fail afterward; the pane remains inspectable when an agent may be present.

## Checks

```bash
bash ~/.pi/agent/extensions/herdr-delegate/run-tests.sh
bash ~/.pi/agent/extensions/herdr-delegate/run-typecheck.sh /path/to/existing/tsc
```

The runner creates and removes an isolated temporary module-resolution tree; it does not install dependencies. Tests drive a real fake CLI process and real result files. Live Herdr worker trials are intentionally left to the overseer.
