---
description: jj commit and push
model: opencode/glm-4.6
subtask: true
---

Prefer `jj` over `git`

Prefer to explain WHY something was done from an end user perspective instead of
WHAT was done.

Do not do generic messages like "improved agent experience" be very specific
about what user facing changes were made

- If there are changes do:
   - `jj sync`
   - `jj retrunk` (if there are any changes from the sync call)
- If there are conflicts DO NOT FIX THEM. notify me and I will fix them
- Prefer `jj commit` over `jj desc`

Make a commit with the above details in context.
