---
name: orchestrate
description: Coordinate scoped implementation, read-only research, and independent review through Worker, Scout, and Reviewer in temporary sibling Herdr panes in the parent's tab. Use for explicit /skill:orchestrate tasks and ordinary requests that benefit from delegation.
---

# Orchestrate

The parent owns intent, scope, and acceptance. Use the blocking `delegate` tool sequentially; no asynchronous orchestration, parallel mutation, recursive planners, or background supervisor. Honor explicit routing, approval, safety, and no-delegation constraints. Outside Herdr, explain that delegation is unavailable; never substitute hidden subprocess workers. Do not launch agents with bash or control panes manually.

## Choose the needed work

- Work directly for tiny, clear, reversible tasks; do not add delegation ceremony.
- Use `role: "worker"` for clear scoped implementation and routine checks.
- Use `role: "scout"` when uncertainty materially affects the plan, including pure research, exploration, questions, or recommendations. Scout is read-only, not an implementation prerequisite.
- Use a fresh `role: "reviewer"` for consequential ownership, security, concurrency, persistence, or broad changes. Independent review is not mandatory for every small change.

Role model and thinking defaults live in their editable role files, not this skill. Scout and Reviewer are always fresh and close after their correlated result is captured. Worker remains available for in-task fixes and closes when the parent truly settles.

## Briefs and acceptance

Give the child the desired outcome, relevant context, boundaries, acceptance evidence, and escalation conditions—not a prescriptive implementation recipe. Ask for changes or findings, exact checks/evidence, risks, discoveries, unresolved questions, and deviations useful to reconsider the plan.

Inspect returned actual changes and evidence. A successful tool response means the worker finished; it does not mean the task is accepted. Adjudicate review findings against requirements and repository evidence; do not demand an unconditional fix pass or speculative refactors. Prefer one review/fix cycle; stop or escalate material scope changes, contradictory evidence, repeated failures, or blockers. Select `timeoutMs` deliberately within 5000–3600000 ms (default 20 minutes); a timeout is not proof of nondelivery.

## One writer and handoffs

One writer per workflow: while an implementation worker owns the changes, the parent, Scout, and Reviewer do not edit alongside it. This is not global cross-session checkout locking.

Prefer the same successful writer for necessary fixes using its opaque `worker` handle plus `task`. The parameter `worker` is a handle, distinct from `role: "worker"`. A new implementation role request is rejected while an existing writer is retained.

Explicit replacement is allowed when needed, including deliberate model/configuration changes:

1. Inspect current changes and available result artifacts. Never blind-redeliver uncertain work.
2. Supply `replace: true`, the old `worker` handle, `role: "worker"`, and a complete parent handoff in `task`: outcome, boundaries, current changes, checks/results, risks, unresolved work, and the next acceptance evidence. State that the replacement must inspect current files before continuing.
3. The runtime validates the currently selected Worker configuration, saves the handoff before retirement, and closes only the exact verified old owned pane (or confirms both agent and pane are absent) before starting the replacement. Ambiguous closure blocks replacement. No silent model fallback or fingerprint update is allowed.
4. Preserve the old result artifacts and returned handoff path. If a failed worker was already closed, use a fresh Worker with the same parent-provided handoff in `task`; do not attempt to reuse a retired handle.

Builder is retired: only Worker, Scout, and Reviewer are callable roles. Legacy persisted builders retain their original role, native identity, and fingerprint for safe cleanup or explicit replacement with Worker. Legacy follow-ups return `role_retired` without changing ownership or delivering work; use the replacement handoff above or `/delegate-cleanup`. No legacy role file is required.

## Safety and lifecycle

Helpers launch as sibling panes in the parent's tab and cwd without taking focus. The extension chooses right or down from the calling pane's geometry; it does not create tabs or workspaces. Cleanup closes only each helper's owned pane, preserving the parent and other work.

A timeout, cancellation, killed transport, or stalled prompt may already have delivered work. Never resubmit it blindly. The extension confirms native identity, stops/closes only the owned pane, and reports cleanup. If identity or closure is unresolved, stop delegation. Use `read_agent_activity` with the returned opaque handle for bounded JSONL diagnosis; activity is not completion proof. Read the Herdr skill before manually inspecting panes. Use `/delegate-cleanup` only as deliberate recovery, not normal workflow.

A retained Worker closes at Pi's `agent_settled` boundary, after retries, compaction retries, and queued continuations are exhausted. Correlated results and artifacts survive cleanup or persistence failure. Inspect cleanup disposition and persistence errors; persistence failure blocks further delegation. Reload drains accepted operations and persists final state without closing an idle retained writer just for reload.

Recovery cleans independently verified owned workers even when another worker or unpinned startup resource remains unresolved. Automatic cleanup never clears unknown authority, adopts foreign/forked ownership, or closes a whole tab containing user-added peer panes. Stale authority is pruned only after explicit missing-agent and missing-pane responses, not timeouts or moved/replaced sessions. Copied empty snapshots are inert.

Actual-target-shell launch preflight is deferred: native Herdr `agent.start` has no environment-validation operation, and `pane process-info` reports process identity rather than shell command resolution/environment. Do not substitute parent-only validation or terminal probes. Existing conservative startup failures remain locked for manual inspection; resolved physical startup alone does not automatically clear an old unpinned lock. Once the existing parent is idle, the user can `/reload`, then `/delegate-cleanup acknowledge-startup`. The command displays the exact record and requires confirmation that the user personally verified no worker from that startup remains, including moved or renamed agents. This is human attestation, not automatic proof; it closes nothing and resends nothing. It refuses foreign/corrupt authority, pinned workers, pending tasks, and active/queued work or cleanup. Failed publication retains the lock for deliberate retry. Never confirm on the user's behalf or treat missing original resource IDs as sufficient proof. Identical automatic cleanup warnings are deduplicated in memory per loaded session instance; reload or resume may remind once. Notification bookkeeping writes no session entries; cleanup itself still runs and manual cleanup still reports its outcome.

Scout and Reviewer use a read-only Bash policy, not a security sandbox. Children cannot delegate, launch other agents, or invoke this skill. Do not add worktrees, commits, token-budget enforcement, or scheduling infrastructure.
