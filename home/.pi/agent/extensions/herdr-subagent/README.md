# Herdr subagent

Pi extension providing a serial `subagent` tool backed by an observable Herdr pane.

## Behavior

- Creates a sibling pane without stealing focus.
- Starts an interactive child Pi through `herdr agent start`.
- Inherits the current provider, model, thinking level, cwd, and project trust by default.
- Streams recent child terminal output into the parent tool result.
- Reports Herdr's `blocked` state so the user can focus the child and respond.
- Writes the final response atomically instead of relying on terminal scrollback.
- Reuses its pane for later calls in the same parent session.
- Serializes calls to avoid concurrent children editing the same working tree.
- Preserves child sessions under `~/.pi/agent/herdr-subagents/`.

The extension registers the tool only when Pi is running inside Herdr (`HERDR_ENV=1`). It closes only its own active or idle pane during abort and parent-session shutdown. If the pane has been repurposed for another process, it leaves that pane open.

## Usage

```text
Use subagent to review the current diff for correctness regressions.
```

Optional tool parameters override `cwd`, `provider`, `model`, or `thinking`.

After installation, run `/reload` in existing Pi sessions. New sessions discover the extension automatically.

## Verification

```sh
bun test ./home/.pi/agent/extensions/herdr-subagent/protocol.test.ts
```
