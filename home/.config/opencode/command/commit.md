---
description: jj commit and push
model: opencode/glm-4.6
subtask: true
---

## Workflow

1. `jj diff` — if empty, report "nothing to commit" and stop
2. `jj sync` — fetch/push remote
3. `jj retrunk` — only if sync pulled new changes
4. `jj commit -m "<message>"` — create commit

If any step reports conflicts: stop immediately, report the conflict output, do not attempt to fix.

## Commit messages

- Explain WHY from end-user perspective, not WHAT code changed
- Be specific about user-visible behavior
- Avoid generic phrases ("improved experience", "cleanup", "refactor")

Good:
- "Show diff summary before edits run"
- "Cache config to speed up startup"

Bad:
- "improve performance"
- "update code"

## Notes

- Always use `jj`, never `git`
- Use `jj commit`; only use `jj desc` if explicitly asked to amend

## Response

After success, reply with:
- The commit message used
- Any sync/retrunk actions taken
