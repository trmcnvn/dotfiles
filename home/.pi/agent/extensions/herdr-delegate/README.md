# Herdr Delegate

A user-global Pi extension that exposes blocking `delegate` and read-only `read_agent_activity` tools for a small, sequential build/review workflow in visible background Herdr tabs.

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

Role frontmatter is editable configuration. `model` must be `provider/id`; `thinking` and every tool are passed exactly to native Pi arguments. The extension validates authentication, tool availability, and whether the exact model supports the requested thinking level before creating a tab, and never silently falls back. A canonical role fingerprint prevents follow-ups after the role changes. Child Pi sessions keep normal repository context and skills, except that the parent-only `delegate` and `read_agent_activity` tools are absent and the `orchestrate` skill is removed from their model catalog and blocked as a skill command.

## Runtime and results

Herdr owns background-tab creation, Pi startup, lifecycle waits, and pane identity. The extension never starts tmux or a raw child Pi subprocess. It explicitly creates the tab in the caller workspace with the caller cwd, a role label, child environment, and `--no-focus`; the worker agent remains pinned to that tab's root pane. A narrowly bounded second `agent start` attempt is allowed only after the known `agent_pane_busy` shell-readiness rejection and a matching, agent-free pane lookup. Each role body is written with mode `0600` to the worker's private artifact directory and its absolute path is passed to `--append-system-prompt`; multiline role text is never placed in the launch argv.

A child reporter recognizes a private task envelope before model input. At Pi's `agent_settled` boundary it atomically writes a task-id/worker-id-correlated JSON result under:

```text
~/.pi/agent/herdr-delegate-runs/<worker>/<task>.json
```

The file records final output, error/abort/incomplete state, native session, model, thinking, and completion time. Only a `stop` response is completed; length, tool-use, and other unfinished responses are incomplete. Model-visible output is capped at Pi's 50 KB/2,000-line limits; the complete result remains at the reported artifact path. Screen text and idle state are never treated as the answer.

Timeout, stalled, blocked, killed, malformed, and cancelled prompt transports may already have delivered input. Pending task identity is persisted before submission. The extension never resubmits. After confirming the pinned native session, it sends Escape and closes that exact owned pane; it does not infer safety from idle state. A terminal failed or incomplete child result is likewise cleaned up after capture. If native identity or pane closure cannot be established, the extension preserves the worker reference and recoverable lock, reports the exact cleanup failure, and includes the opaque worker handle for `read_agent_activity` diagnosis and `/delegate-cleanup` recovery. Cleanup closes only the matching owned pane—never its whole tab—so user-added panes are preserved; Herdr disposes an empty worker tab when its sole root pane closes. Reusable builders must be idle before prompting.

Worker identity, tab/workspace identity for new workers, launch fingerprint, pending task, parent Pi session ID, and unsafe-writer lock are stored in Pi custom entries and restored across `/reload`; legacy persisted pane workers remain valid. A fork that copied entries refuses to adopt, inspect, or clean the original session's workers. Ambiguous or unpinned startup resources are left inspectable with the exact pane/manual-recovery issue rather than claimed as cleaned.

A fresh reviewer closes immediately after its correlated result artifact and output are captured. A successful builder remains pinned for review follow-ups. The parent extension closes all still-owned workers at Pi's `agent_settled` boundary, which occurs only after the complete parent run has no automatic retry, compaction retry, or queued continuation left; it does not clean on transient turn/tool completion. Cleanup and delegation exclude each other in both directions. Each confirmed pane closure persists the remaining references before cleanup continues, so partial cleanup stays recoverable. Existing workers owned by the same restored parent session are included at its next settled boundary, while foreign/fork authority is never adopted. Non-reload session shutdown remains a final backstop.

Every closure first requires matching agent name, pane, and native session. Completed correlated output and its artifact are returned even when reviewer cleanup fails, alongside an explicit `closed`, `retained`, or `failed` cleanup outcome. Cleanup failure retains the worker reference and safety lock. `/delegate-cleanup` remains available for recovery, not normal workflow.

`read_agent_activity({ worker, cursor? })` confirms that same live native identity, then incrementally reads the worker's Pi session JSONL directly. It returns bounded assistant text, tool calls/results, errors, branch/parent information, compaction markers, and an opaque continuation cursor. Thinking blocks are excluded. Each page reads at most 64 KB of JSONL payload plus bounded header and continuity-anchor I/O, and returns at most 50 rendered records, 2 KB per rendered record, and 20 KB of activity; oversized records are scanned over bounded pages and omitted with a marker once their newline is found. Partial trailing records are retained without advancing the record boundary. Cursors are repeatable and do not mutate shared position; cursor/worker mismatch, middle-of-record offsets, inode replacement, observed shrinkage, bounded boundary-continuity failures, malformed headers, and native/header identity changes are rejected. Continuity anchors detect rewrites near consumed and oversized-scan boundaries, not arbitrary mutation elsewhere in an already observed file. Malformed complete records are reported and skipped. This is an append-order activity log across branches and compactions, not a reconstructed current conversation and not completion proof. The task-correlated result artifact remains the sole completed-task answer. The reader never writes session JSONL.

The reviewer has `bash` for read-only inspection. Its role policy forbids write-producing commands, but this is not a security sandbox: shell access can technically write.

## Limitations

- Herdr 0.9.0 and its current Pi lifecycle integration are required (`HERDR_ENV=1`). There is no hidden-worker fallback.
- State is scoped to the current Pi session branch. Do not manually rename, move, replace, or close owned workers while delegating. A fresh/reloaded instance acts only on authority restored for the same native parent session.
- v1 has exactly two global roles, one writer, sequential blocking tasks, and one normal review/fix cycle. It has no project role overrides, parallel batches, inheritance, extra roles, streaming token updates, or asynchronous orchestration.
- The model/tool availability check uses the current parent Pi catalog. Authentication or provider startup can still fail afterward; the pane remains inspectable when an agent may be present.

## Checks

```bash
bash ~/.pi/agent/extensions/herdr-delegate/run-tests.sh
bash ~/.pi/agent/extensions/herdr-delegate/run-typecheck.sh /path/to/existing/tsc
```

The runner creates and removes an isolated temporary module-resolution tree; it does not install dependencies. Tests drive a real fake CLI process and real result files. Live Herdr worker trials are intentionally left to the overseer.
