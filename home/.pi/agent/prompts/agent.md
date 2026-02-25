---
description: Consult a named subagent for deeper analysis before acting
---
Tell the user you're consulting the "$1" subagent and why, then use the `consult_subagent` tool with:
- `agent`: `$1`
- `task`: `${@:2}`

Treat the subagent's response as advisory. Summarize the recommendation, key risks, and the next action you suggest.
