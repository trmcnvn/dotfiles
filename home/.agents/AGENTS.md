## Defaults

- Optimize for minimal, correct, maintainable changes
- Match repository conventions and prefer existing patterns over new abstractions
- Avoid features, configurability, refactors, or collateral changes beyond the request
- Follow YAGNI principles
- When deleting code, leave no vestigial traces, whale legs, or references to the old implementation
- Never write a new unit test or integration test unless explicitly instructed. You may write new e2e or system level tests
- Never add new code comments
- Rather than dirty up the present working directory, put "temporary" work files in ./tmp if it exists or /tmp if it does not

## Communication

- Apply ASD-STE100 Simplified Technical English
- Be extremely concise; keep interaction, commit, and PR text tight and useful
- Ask only when blocked, when ambiguity materially changes the outcome, or before outward-facing actions I haven't requested (push, publish, deploy, messaging other people) or irreversible, shared, production-visible, privileged, or costly actions
- State consequential assumptions briefly

## Workflow

- Retrieve available context before asking questions or making claims about code
- Within the task I gave you, keep going: fix, retry, and take the next in-scope step yourself; do not stop at analysis when implementation is clearly requested
- Do not modify files when the user asks only for analysis, review, or recommendations
- Verify completed work with the smallest relevant check and state exactly what was not run
- Do not add dependencies, change package managers, or alter generated or lock files unless required

## Shell

- The user's interactive shell is Nushell (`nu`); write scripts and snippets for the user in Nushell, not Bash/zsh/POSIX sh
- Use idiomatic Nushell (structured data, pipelines, `def` commands) and current syntax; check `nu --version` and `help <command>` when unsure
- Repository conventions take precedence: match the existing shell of scripts in a repo

## Background Processes

- Run long-lived or background processes (port-forwards, dev servers, watchers, CI polls, long jobs) in `rex` so the user can monitor them; do not use harness background tasks, `&`, or `nohup`
- Session = your harness (`claude-code`, `codex`, `pi`, ...); window (tab) = your thread's branch name, or the thread title slug if there is no branch
- If the harness session is missing, create it with the tab: `rex new <harness> --window <tab> --keep-open -- <command>`; otherwise add the tab: `rex window new -s <harness> <tab> --focus=false --keep-open -- <command>`
- Put further processes for the same thread in that tab: `rex run -s <harness> -w <tab> --split right --focus=false -- <command>`
- Inspect with `rex ls`, `rex window ls -s <harness>`, and `rex capture -s <harness> -w <tab>`; when finished, close only your tab with `rex window close -s <harness> <tab>`, never the shared session
- If `rex` is not on PATH, use `~/Library/Application Support/com.superlogical.rex/RexServer/Versions/Current/Rex Server.app/Contents/MacOS/rex`

## Safety

- Do not overwrite user changes without explicit permission

## Dotfiles

- Personal dotfiles are managed by `mise bootstrap dotfiles`, configured in `~/.config/mise/config.toml`, not by direct Git operations in `~` or `~/.config`
- Inspect the `[dotfiles]` configuration and `mise bootstrap dotfiles status` before changing dotfiles; current entries use `mode = "track"`, so edit the live files in place, not a separate source checkout
- Use mise's dotfile commands for tracking, history, and synchronization; consult subcommand `--help` before unfamiliar operations
- Do not run `mise bootstrap dotfiles sync` or otherwise publish changes unless explicitly requested; the backing Git repository is managed through mise

## Version Control

- Commit locally to the current branch as you finish each logical unit, staging only your own hunks; never in mise-managed dotfiles
