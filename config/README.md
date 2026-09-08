# dotfiles

**My macOS workstation, managed by [mise](https://mise.jdx.dev/).**

Shells, editors, agent extensions, and machine setup. Edit the files where
the applications use them; mise saves their history and keeps machines in sync.

**Regular files. Automatic history. Explicit machine setup.**

---

## Take a look around

| Area | Configuration |
| --- | --- |
| Shells | [Bash](../home/.bashrc) · [Nushell](../home/.config/nushell) |
| Editors | [Neovim](../home/.config/nvim) · [Zed](../home/.config/zed) |
| Terminal & windows | [Ghostty](../home/.config/ghostty) · [AeroSpace](../home/.config/aerospace) |
| Version control | [Git](../home/.gitconfig) · [Jujutsu](../home/.config/jj) |
| Agents | [Shared skills](../home/.agents/skills) · [Pi extensions](../home/.pi/agent/extensions) |
| Workspace | [Herdr](../home/.config/herdr) |
| Machine setup | [Mise configuration](config.toml) · [Setup tasks](tasks) |

```text
.
├── .mise-history/          # Mise's snapshot metadata
├── config/                # Restored to ~/.config/mise/
│   ├── README.md
│   ├── config.toml        # Tools, packages, tracking, defaults, and services
│   └── tasks/             # Explicit setup, checks, and updates
└── home/                  # Tracked files, relative to ~/
    ├── .agents/skills/
    ├── .config/
    ├── .pi/agent/
    ├── .bashrc
    └── .gitconfig
```

`home/` is the **saved representation** of the live files, not a source
directory to symlink into place. Individual files and their diffs are still
ordinary, browsable Git content.

## Set up a Mac

This is a personal setup, not a generic installer. Review the configuration
and tasks before applying them: bootstrap can install software, write macOS
preferences, and configure the login shell.

Install **Git** and **mise 2026.9.2 or newer**, then configure GitHub
authentication that also works non-interactively for the background watcher.

```sh
mise bootstrap --adopt trmcnvn/dotfiles
mise bootstrap dotfiles status
```

Mise restores the tracked files and applies the saved setup. Existing-file
conflicts must be resolved before bootstrap can continue.

The `mise` branch is the active setup and repository default.
[`main`](https://github.com/trmcnvn/dotfiles/tree/main) preserves the previous
Stow-based setup.

## Everyday use

**Edit normally.** There is no copy-back or re-stow step.

```sh
# Check tracking, local saves, and synchronization.
mise bootstrap dotfiles status

# See exactly which files are enrolled.
mise bootstrap dotfiles paths

# Start saving a new file.
mise bootstrap dotfiles track ~/.config/example/config.toml

# Run the workstation's configuration checks.
mise run workstation:check
```

Tracking uses an **individual-file allowlist**. New files are not silently
enrolled just because they sit beside an existing configuration file.

On macOS, the `mise-history` LaunchAgent handles local saves and GitHub sync.
With the default timings, ordinary edits are saved after two quiet seconds,
pushed within five minutes, and incoming changes checked every fifteen minutes.

### Apply setup changes intentionally

Synchronizing a config file does **not** install new tools, upgrade packages,
apply macOS preferences, or run setup tasks.

```sh
# Preview and apply the declared machine setup.
mise bootstrap --dry-run
mise bootstrap

# Explicitly update configured packages and Pi.
mise run workstation:update
```

Tool versions stay pinned in `config.toml`; update those pins deliberately.
Existing Homebrew-owned casks still use Homebrew for upgrades until their
ownership is deliberately migrated. Mise itself is currently installed with
Homebrew and updated with `brew upgrade mise`.

## Go back to a working version

```sh
mise bootstrap dotfiles history --path ~/.bashrc
mise bootstrap dotfiles rollback ~/.bashrc --dry-run
mise bootstrap dotfiles rollback ~/.bashrc

# Reverse that rollback without reverting unrelated files.
mise bootstrap dotfiles undo
```

Rollback creates new history rather than erasing old commits. With sync
enabled, the restored contents can reach the other machines too.

## When machines disagree

A conflict pauses publication and incoming application for the whole setup.
Local history continues saving; mise does not insert conflict markers into
live configuration.

```sh
mise bootstrap dotfiles status

# Choose one resolution for each conflicting file:
mise bootstrap dotfiles pull --keep-local ~/.bashrc
# or
mise bootstrap dotfiles pull --take-remote ~/.bashrc
```

Sharing resumes after all conflicts are resolved. Homebrew builds may not
provide desktop conflict notifications, so check status when files seem stale.

## A note about public history

**This repository is public and pushes are automatic.** Every captured
version can be published, including temporary edits.

Keep credentials out of tracked files. Deleting a secret from the current file
does not remove it from earlier snapshots. Authentication stores, Pi sessions,
caches, and broad application-state directories are not intentionally enrolled.
