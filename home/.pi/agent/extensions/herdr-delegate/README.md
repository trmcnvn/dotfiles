# Herdr Delegate

A user-global Pi extension that exposes blocking `delegate` and read-only `read_agent_activity` tools for scoped implementation, research, and independent review in visible background Herdr tabs.

## Use

Start a normal Pi session (its default model is unchanged), then run:

```text
/skill:orchestrate <task>
```

Pi may also load the orchestration skill for ordinary requests that benefit from delegation. Tiny, clear, reversible tasks can stay direct; use Scout for material uncertainty and independent Reviewer for consequential ownership, security, concurrency, persistence, or broad changes, not mandatory ceremony. The extension has no startup spawn and no keyword trigger.

The tool catalog lists three roles from their global files:

- `~/.pi/agent/agents/worker.md` — scoped implementation and routine checks.
- `~/.pi/agent/agents/scout.md` — read-only research, evidence, options, and unresolved questions.
- `~/.pi/agent/agents/reviewer.md` — fresh independent actionable review.

A new task uses `role` plus `task`. A successful Worker result includes an opaque `worker` handle; use `worker` plus `task` for necessary fixes in that same session. The handle parameter is distinct from the Worker role. Scout and Reviewer reuse is rejected. Calls are serialized; another writer cannot start while one is retained in this runtime. This is workflow ownership, not global cross-session checkout locking. The parent supplies outcomes, boundaries, acceptance evidence, and escalation conditions, not an implementation recipe. Children return evidence, risks, discoveries, and deviations; a finished worker does not imply parent acceptance.

Role frontmatter is editable configuration. `model` must be `provider/id`; `thinking` and every tool are passed exactly to native Pi arguments. The extension validates authentication, tool availability, and whether the exact model supports the requested thinking level before creating a tab, and never silently falls back. A canonical role fingerprint prevents follow-ups after the role changes. Child Pi sessions keep normal repository context and skills, except that the parent-only `delegate` and `read_agent_activity` tools are absent and the `orchestrate` skill is removed from their model catalog and blocked as a skill command.

## Runtime and results

New delegated Pi processes receive `--session-dir ~/.pi/agent/herdr-delegate-runs/<worker>/sessions`, a private `0700` directory outside personal session history. Worker, Scout, and Reviewer transcripts therefore do not appear in the parent's normal `/resume` or all-project session list. This deliberately retains private runtime JSONL for native Herdr identity, live activity reads, and diagnostics; it is not `--no-session` and does not automatically erase transcripts. Existing personal/legacy sessions are neither moved nor deleted. This applies to launches through this extension, not arbitrary manual `herdr agent start` commands.

Herdr owns background-tab creation, Pi startup, lifecycle waits, and pane identity. The extension never starts tmux or a raw child Pi subprocess. It explicitly creates the tab in the caller workspace with the caller cwd, a role label, child environment, and `--no-focus`; the worker agent remains pinned to that tab's root pane. A narrowly bounded second `agent start` attempt is allowed only after the known `agent_pane_busy` shell-readiness rejection and a matching, agent-free pane lookup. Each role body is written with mode `0600` to the worker's private artifact directory and its absolute path is passed to `--append-system-prompt`; multiline role text is never placed in the launch argv.

A child reporter recognizes a private task envelope before model input. At Pi's `agent_settled` boundary it atomically writes a task-id/worker-id-correlated JSON result under:

```text
~/.pi/agent/herdr-delegate-runs/<worker>/<task>.json
```

The file records final output, error/abort/incomplete state, native session, model, thinking, and completion time. Only a `stop` response is completed; length, tool-use, and other unfinished responses are incomplete. Model-visible output is capped at Pi's 50 KB/2,000-line limits; the complete result remains at the reported artifact path. Screen text and idle state are never treated as the answer.

Timeout, stalled, blocked, killed, malformed, and cancelled prompt transports may already have delivered input. Pending task identity is persisted before submission. The extension never resubmits. After confirming the pinned native session, it sends Escape and closes that exact owned pane; it does not infer safety from idle state. A terminal failed or incomplete child result is likewise cleaned up after capture. If native identity or pane closure cannot be established, the extension preserves the worker reference and recoverable lock, reports the exact cleanup failure, and includes the opaque worker handle for `read_agent_activity` diagnosis and `/delegate-cleanup` recovery. Cleanup closes only the matching owned pane—never its whole tab—so user-added panes are preserved; Herdr disposes an empty worker tab when its sole root pane closes. Reusable writers must be idle before prompting.

Worker identity, tab/workspace identity for new workers, launch fingerprint, pending task, parent Pi session ID, and unsafe-writer lock are stored in Pi custom entries and restored across `/reload`; legacy persisted pane workers remain valid. A fork that copied actual worker or recovery authority refuses to adopt, inspect, or clean the original session's workers; an empty copied snapshot is inert and permits fresh delegation. Ambiguous or unpinned startup resources are left inspectable with the exact pane/manual-recovery issue rather than claimed as cleaned.

A fresh Scout or Reviewer closes immediately after its correlated result artifact and output are captured. A successful Worker (or legacy builder) remains pinned for in-task follow-ups. The parent extension closes all still-owned workers at Pi's `agent_settled` boundary, which occurs only after the complete parent run has no automatic retry, compaction retry, or queued continuation left; it does not clean on transient turn/tool completion. Cleanup and delegation exclude each other in both directions. Each confirmed pane closure persists the remaining references before cleanup continues, so partial cleanup stays recoverable. Existing workers owned by the same restored parent session are included at its next settled boundary, while foreign/fork authority is never adopted. Reload shutdown drains accepted operations and persists their final snapshot before Pi invalidates the old extension. Pi sets its idle flag before awaiting settled handlers, so checking idle alone is not sufficient. Reload alone does not close a retained idle writer. Non-reload session shutdown drains first and remains a final cleanup backstop.

Every closure first requires matching agent name, pane, native session, and any pinned tab/workspace identity. Cleanup continues across independent workers and aggregates remaining failures without clearing unpinned startup authority. An already-absent worker is pruned without a close only when structured Herdr errors specifically report `agent_not_found` or `agent_name_not_found` and `pane_not_found`; `agent_not_running`, timeouts, killed commands, replacements, and moved sessions are not absence evidence. Completed correlated output and its artifact are returned even when read-only worker cleanup fails, alongside an explicit `closed`, `retained`, or `failed` cleanup outcome. Cleanup failure retains the worker reference and safety lock. State publication failures are classified as `state_persist_failed`, block new delegation in memory, and never erase captured output or falsify the cleanup disposition. Their persisted recovery field is separate from unknown startup authority, so cleanup can clear it only after publishing the recovered state successfully. Completed results include a separate `persistenceError` when applicable. A pending task must persist before prompt submission. Confirmed closures update memory even if their publication fails; subsequent recovery can reconcile stale persisted references using the strict absence checks. `/delegate-cleanup` remains available for recovery, not normal workflow.

`read_agent_activity({ worker, cursor? })` confirms that same live native identity, then incrementally reads the worker's Pi session JSONL directly. It returns bounded assistant text, tool calls/results, errors, branch/parent information, compaction markers, and an opaque continuation cursor. Thinking blocks are excluded. Each page reads at most 64 KB of JSONL payload plus bounded header and continuity-anchor I/O, and returns at most 50 rendered records, 2 KB per rendered record, and 20 KB of activity; oversized records are scanned over bounded pages and omitted with a marker once their newline is found. Partial trailing records are retained without advancing the record boundary. Cursors are repeatable and do not mutate shared position; cursor/worker mismatch, middle-of-record offsets, inode replacement, observed shrinkage, bounded boundary-continuity failures, malformed headers, and native/header identity changes are rejected. Continuity anchors detect rewrites near consumed and oversized-scan boundaries, not arbitrary mutation elsewhere in an already observed file. Malformed complete records are reported and skipped. This is an append-order activity log across branches and compactions, not a reconstructed current conversation and not completion proof. The task-correlated result artifact remains the sole completed-task answer. The reader never writes session JSONL.

Scout and Reviewer permit only `read` and `bash`. Their read-only policy forbids tests, builds, formatters, installers, and other write-producing commands, but this is not a security sandbox: shell access can technically write. Every child is instructed not to delegate, launch agents, or invoke orchestration.

## Unpinned startup recovery

Automatic cleanup still runs after each settled parent run, but identical failures notify only once. A changed failure notifies again; successful cleanup or acknowledged recovery clears the notice. Notice deduplication is in memory only, scoped to each loaded session instance; reload or resume may remind once. Manual `/delegate-cleanup` always reports its outcome. Notification failures are retried. Notification bookkeeping writes no session entries and never clears a safety lock; cleanup and safety-state persistence remain independent. This avoids adding notification-related ancestry failures, but does not fix Pi's pre-existing session append failure semantics.

If an old startup record has no pinned worker, physically closing the failed startup pane does not prove that a moved or renamed agent is absent. For this case only:

1. Finish active delegation/cleanup and let the parent become idle with no queued messages.
2. In the **existing parent's Pi editor**, enter `/reload` and wait for it to finish. Global extension discovery loads this repair without `/new` or session-file edits.
3. Enter `/delegate-cleanup acknowledge-startup`.
4. Read the exact displayed startup record. Confirm **only after personally verifying that no worker from that startup remains**, including moved or renamed agents, and disposing of leftover startup resources as appropriate. Otherwise cancel; the lock remains.

This is explicit human attestation, not automatic verification. The command closes no panes, sends no prompts, deletes no history, and clears only the displayed, unchanged startup lock after successful state publication. It refuses foreign or corrupt authority, pinned workers/unsafe writers, pending tasks, active or queued delegation, concurrent cleanup, headless confirmation, and parent activity that changes while confirming. A confirmation from before reload cannot affect the new runtime. Failed publication retains the in-memory lock and allows another deliberate confirmation after persistence is repaired. Ordinary `/delegate-cleanup` remains the recovery path for pinned authority; there is no general force reset.

New failures after a validated tab creation retain structured worker handle, requested agent name, pane, tab, and workspace provenance for diagnosis. Those fields are not native-session ownership or deletion authority. Legacy diagnostic text is recognized only to limit acknowledgment to startup records, never parsed into deletion targets. Herdr 0.9.0 permits agent movement/renaming and the failed launch supplied no pinned native session, so absence of the original pane/tab/name alone cannot establish verified recovery. No automatic unpinned closure or absence-based unlock is attempted.

## Replacement and compatibility

Prefer the same writer for fixes. For deliberate replacement, call `delegate({ replace: true, worker: oldHandle, role: "worker", task: parentHandoff })`. The task must contain the complete parent handoff: current changes, available result/check evidence, risks, remaining work, boundaries, and acceptance conditions. Inspect current files before continuing; never blind-redeliver uncertain work.

The runtime validates the explicitly selected current Worker configuration, writes a private `replacement-<id>.md` handoff under the old worker's artifact directory, then retires only the exact verified owned pane (or confirms both agent and pane are absent). It starts the new writer only after confirmed closure and successful state publication. Ambiguous closure retains a lock; handoff-write failure leaves the old worker untouched. Result artifacts are not deleted. Successful replacement results include `replacement.worker` and `replacement.handoffPath`. A failed worker already auto-closed can instead be followed by a fresh Worker with a parent-provided handoff. There is no automatic redelivery, model fallback, or supervisor.

New public `role: "builder"` calls remain a compatibility alias for Worker. Persisted builders keep their role, native session/name/pane, and original fingerprint unchanged; their follow-ups still load the unchanged legacy `builder.md`. Keep that file while legacy workers may be reused; it is not in the role catalog and is not a new-task default. The internal runtime also retains the old explicit builder launch contract for existing callers. Edit `worker.md` for new defaults. Configuration drift rejects ordinary follow-ups; only explicit replacement selects new configuration. Worker defaults were copied from the existing builder; Scout defaults were copied from the existing read-only Reviewer. No model identities are embedded in workflow prose.

The v1 task envelope, child result artifact/status protocol, old persisted records, and legacy `builder_followups` cleanup reason remain compatible. New Worker retention uses `worker_followups`. Scout/Reviewer cleanup and parent `agent_settled` behavior share the existing ownership checks.

## Limitations

- Herdr 0.9.0 and its current Pi lifecycle integration are required (`HERDR_ENV=1`). There is no hidden-worker fallback.
- State is scoped to the current Pi session branch. Do not manually rename, move, replace, or close owned workers while delegating. A fresh/reloaded instance acts only on authority restored for the same native parent session.
- Three canonical global roles, one workflow writer, and sequential blocking tasks. No project role overrides, parallel mutation, recursive planning, token-budget enforcement, scheduler, metrics daemon, streaming token updates, or asynchronous orchestration.
- The model/tool availability check uses the current parent Pi catalog, not the target shell's launch environment. Actual-target-shell preflight is deferred: Herdr 0.9.0 native `agent.start` exposes no environment-validation operation; `pane process-info` reports process identity, not shell command resolution/environment. No terminal probes or parent-only substitute were added. A mise Node/Pi shim mismatch can still time out at startup. Conservative unpinned-startup locks and manual inspection remain required; physical cleanup alone does not automatically clear an old lock. Use the explicit startup acknowledgment above after verification.

## Checks

```bash
bash ~/.pi/agent/extensions/herdr-delegate/run-tests.sh
bash ~/.pi/agent/extensions/herdr-delegate/run-typecheck.sh /path/to/existing/tsc
```

The runner creates and removes an isolated temporary module-resolution tree; it does not install dependencies. Tests drive a real fake CLI process and real result files. Live Herdr worker trials are intentionally left to the overseer.
