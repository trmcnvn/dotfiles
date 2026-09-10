---
name: orchestrate
description: Coordinate implementation through a sole Sol builder and fresh Astra reviewer in visible background Herdr tabs. Use for explicit /skill:orchestrate implementation tasks and ordinary implementation requests suited to delegated build-and-review.
---

# Orchestrate

Use the blocking `delegate` tool for a minimal sequential build-and-review workflow. Workers run in background Herdr tabs. This does not provide streaming token updates or asynchronous orchestration. Do not launch agents with bash or control panes manually. Use `read_agent_activity` with an owned worker handle for bounded JSONL activity when diagnosis is needed; activity is not completion proof. Read the Herdr skill before diagnosing or manually inspecting worker panes.

## Preconditions

- Confirm the task is implementation, not merely a question, research request, plan, or recommendation.
- Honor explicit routing, approval, safety, and no-delegation constraints.
- Outside Herdr, stop and explain; never fall back to hidden subprocess workers.

## Workflow

1. Scope the goal, relevant context, allowed files, constraints, and acceptance checks. Resolve material ambiguity before delegation.
2. Call `delegate` with `role: "builder"` and the complete implementation brief. Sol is the only writer.
3. Inspect the returned actual changes as needed. Do not treat builder reasoning as evidence.
4. Call `delegate` with `role: "reviewer"` and provide the original requirements plus paths/diff scope for the actual changes. Every review uses a fresh Astra worker. Do not ask the reviewer to run write-producing checks.
5. Adjudicate findings against the requirements and repository evidence. Do not apply an unconditional fix pass.
6. For necessary fixes only, call `delegate` with the successful builder's opaque `worker` id and a precise fix request. Never send fixes to a new writer.
7. Verify with the smallest relevant checks and summarize changed paths, review outcome, checks, and limitations. When the parent task settles after all review, fixes, and verification, automatic owned-worker cleanup closes the retained builder.

Use one review/fix cycle by default. Stop or ask the user on blockers, contradictory findings, repeated failure, or a decision that materially changes scope. Never create infinite review loops.

## Safety and ownership

Delegations are sequential. A timeout, cancellation, killed transport, or stalled prompt may already have been delivered; never resubmit it. The extension confirms native session identity, stops/closes only that owned pane, and reports the cleanup outcome. If identity or cleanup remains unresolved, the error includes the opaque worker handle and retains the delegation lock: stop all further delegation, use `read_agent_activity` if JSONL activity helps diagnosis, then use `/delegate-cleanup` only as deliberate recovery. Never treat `/delegate-cleanup` as a normal workflow step. Cleanup never closes a whole tab containing user-added panes.

A reviewer is always fresh and its pane closes after its correlated result is captured. A successful builder remains available for review fixes during the same parent task, then closes automatically only at Pi's `agent_settled` boundary, after retries, compaction retries, and queued continuations are exhausted. Completed output and its result artifact remain authoritative even if pane cleanup fails.

Workers remain visible while active. Do not close arbitrary panes. The reviewer has a read-only operating policy, but because it has bash for inspection that policy is not a security sandbox.
