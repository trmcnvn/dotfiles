---
name: jj-submit
description: Commit Jujutsu work, or commit it and open a GitHub pull request.
disable-model-invocation: true
---

# JJ Submit

## Invocation

Accept one of:

```text
commit [auto|single|split] [guidance]
pr     [auto|single|split] [guidance]
```

The first word is required. `commit` ends after local commits; `pr` continues through push and pull-request creation. The strategy defaults to `auto`; remaining text guides grouping, messages, title, or base. Resolve an unrecognized mode or strategy with the user before changing repository state.

## 1. Establish the boundary

Inspect `jj status`, `jj diff --stat`, the relevant full diff, recent commit descriptions, and the commits between the target base and `@`. Use the current session and diff to separate this task from pre-existing work. Resolve materially ambiguous ownership with the user.

Confirm the relevant verification result from this session, running the smallest missing check when practical, then inspect status again.

**Complete when:** every intended change is identified, pre-existing work is accounted for, the target base is known, and verification has a recorded result.

## 2. Make an atomic plan

Apply the selected strategy:

- `auto`: use one commit for one concern; use multiple commits for distinct, independently reviewable concerns.
- `single`: use exactly one commit for all intended changes.
- `split`: require two or more coherent commits. If no honest split exists, ask before falling back to one.

Order multiple commits so foundations precede dependants. Keep tests with the behavior they verify. Assign every intended file or hunk exactly once and leave pre-existing work unassigned. For hunk-level separation, use JJ's interactive diff editor when available; otherwise preserve the working copy and ask the user to split the hunks.

**Complete when:** the plan covers every intended change exactly once, each commit has one clear purpose, and each intermediate revision is valid when practical.

## 3. Commit the plan

Match the repository's recent message style. For one commit, run:

```bash
jj commit -m '<message>'
```

For multiple commits, select each file-level group in dependency order:

```bash
jj commit <filesets> -m '<message>'
```

Repeat until all planned groups are committed. If the intended work is already committed, preserve that history and identify its tip rather than creating an empty revision.

Inspect `jj status`, the resulting log, and each new revision's diff. The intended tip must be `@-`; unrelated working-copy changes may remain in `@`.

**Complete when:** every intended change is present in exactly one planned revision, every description is non-empty, `@-` is the intended tip, pre-existing work remains intact, and verification status is known.

## 4. Finish the selected mode

For `commit`, stop and report the commit summaries and verification result.

Only for `pr`, and only after step 3 is complete, read [PULL_REQUEST.md](PULL_REQUEST.md) and follow every step.
