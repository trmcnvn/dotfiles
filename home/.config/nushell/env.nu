use std/util "path add"

# XDG Base Directories
$env.XDG_CACHE_HOME = ($env.HOME | path join ".cache")
$env.XDG_CONFIG_HOME = ($env.HOME | path join ".config")
$env.XDG_DATA_HOME = ($env.HOME | path join ".local" "share")
$env.XDG_STATE_HOME = ($env.HOME | path join ".local" "state")

# Delta
$env.DELTA_CONFIG_DIR = ($env.XDG_CONFIG_HOME | path join "delta")

# Editor
$env.EDITOR = "nvim"
$env.SUDO_EDITOR = "nvim"

# GPG
$env.GPG_TTY = (tty)

# Jujutsu
$env.JJ_CONFIG = ($env.XDG_CONFIG_HOME | path join "jj" "config.toml")

# Ripgrep
$env.RIPGREP_CONFIG_PATH = ($env.XDG_CONFIG_HOME | path join "ripgrep" "config")

# Bat
$env.BAT_THEME = "ansi"

# Rust / Cargo
$env.RUST_WITHOUT = "rust-docs"
$env.CARGO_HOME = ($env.XDG_DATA_HOME | path join "cargo")

# Bun
$env.BUN_INSTALL = ($env.HOME | path join ".bun")

# Script search path (must be set here so config.nu can `source` from scripts/)
$env.NU_LIB_DIRS = [
    ($env.XDG_CONFIG_HOME | path join "nushell" "scripts")
]

# Extra PATH entries — must be set before mise captures its baseline
path add [
    { macos: "/opt/homebrew/bin" }
    ($env.HOME | path join ".local" "bin")
    ($env.HOME | path join "Code" "dotfiles")
    ($env.CARGO_HOME | path join "bin")
    ($env.BUN_INSTALL | path join "bin")
]

# Generate cached init scripts for tools that need `source` in config.nu.
# These MUST exist before config.nu is parsed (source is parse-time).
let cache_dir = ($env.XDG_CACHE_HOME | path join "nushell")
mkdir $cache_dir

# Mise activation embeds the executable's absolute path. Refresh it on each
# shell start so an upgrade, relocation, or uninstall cannot leave stale hooks.
let mise_cache = ($cache_dir | path join "mise-init.nu")
let mise_init = if (which mise | is-not-empty) {
    try {
        ^env -u MISE_SHELL -u __MISE_DIFF -u __MISE_SESSION mise activate nu
    } catch {
        ""
    }
} else {
    ""
}
# Replace atomically: another shell may be sourcing this file concurrently.
let mise_tmp = (mktemp --tmpdir-path $cache_dir mise-init.XXXXXX)
$mise_init | save --force $mise_tmp
mv --force $mise_tmp $mise_cache

# zoxide
let zoxide_cache = ($cache_dir | path join "zoxide-init.nu")
if not ($zoxide_cache | path exists) {
    if (which zoxide | is-not-empty) {
        zoxide init nushell | save --force $zoxide_cache
    } else {
        "" | save --force $zoxide_cache
    }
}

# jj completions
let jj_cache = ($cache_dir | path join "jj-completions.nu")
if not ($jj_cache | path exists) {
    if (which jj | is-not-empty) {
        jj util completion nushell | save --force $jj_cache
    } else {
        "" | save --force $jj_cache
    }
}

