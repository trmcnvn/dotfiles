# Workstation managed by mise

Edit the live configuration files under your home directory. They are regular
files, not links to the old dotfiles checkout.

## History and synchronization

The macOS `mise-history` LaunchAgent saves tracked edits automatically.
It pushes to the public `trmcnvn/dotfiles` repository's `mise` branch and
fetches/applies changes from other machines. `mise` is the default branch;
`main` preserves the old Stow setup.

Every captured version can be published, including temporary edits. Keep
credentials out of tracked files. Tracking is an exact-file allowlist:
new files require `mise bootstrap dotfiles track <path>`.

```sh
mise bootstrap dotfiles status
mise bootstrap dotfiles paths
mise bootstrap dotfiles history --path ~/.bashrc
mise bootstrap dotfiles rollback ~/.bashrc --dry-run
mise bootstrap dotfiles rollback ~/.bashrc
mise bootstrap dotfiles undo
```

Conflicts pause outgoing publication and incoming application for the whole
setup, but local saves continue. Inspect status, then resolve each file with
`mise bootstrap dotfiles pull --keep-local <path>` or `--take-remote <path>`.
Homebrew mise builds may not provide desktop conflict notifications.

## Setup and maintenance

```sh
mise bootstrap --dry-run
mise bootstrap
mise run workstation:check
mise run workstation:update
```

File synchronization does not install updated package/tool/service declarations.
Run bootstrap explicitly to apply those. Tool versions remain pinned in
`config.toml`; change the pins intentionally.

Existing Homebrew-owned casks remain installed without destructive reinstalls.
Mise does not automatically take ownership of their upgrade receipts; use
Homebrew for those casks until their ownership is deliberately migrated.
Mise itself is currently Homebrew-installed (`brew upgrade mise`).

The old `dot` command is retired. Do not run Stow against the archived source
tree: doing so would reintroduce competing file ownership.

## Another machine

Install Git and mise 2026.9.2 or newer, and configure Git authentication that
works non-interactively for the watcher. Then:

```sh
mise bootstrap --adopt trmcnvn/dotfiles
mise bootstrap dotfiles status
```

Review existing-file conflicts before accepting setup. This setup targets
macOS. No credentials, Pi sessions, or broad application-state directories
are intentionally enrolled.
