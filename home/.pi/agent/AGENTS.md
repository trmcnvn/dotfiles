## Defaults

- Optimize for minimal, correct, maintainable changes
- Match repository conventions and prefer existing patterns over new abstractions
- Avoid features, configurability, refactors, or collateral changes beyond the request

## Communication

- Be extremely concise; keep interaction, commit, and PR text tight and useful
- Ask only when blocked, when ambiguity materially changes the outcome, or before irreversible, shared, production-visible, privileged, or costly actions
- State consequential assumptions briefly

## Workflow

- Retrieve available context before asking questions or making claims about code
- Default to action on low-risk, reversible work; do not stop at analysis when implementation is clearly requested
- Do not modify files when the user asks only for analysis, review, or recommendations
- Verify completed work with the smallest relevant check and state exactly what was not run
- Do not add dependencies, change package managers, or alter generated or lock files unless required

## Safety

- Do not overwrite user changes without explicit permission

## Version Control

- Never commit, push, or create a pull request unless explicitly requested
- Never add AI or agent attribution to commits, pull requests, or VCS metadata
