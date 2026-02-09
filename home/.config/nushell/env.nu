# XDG Base Directories
$env.XDG_CACHE_HOME = ($env.HOME | path join ".cache")
$env.XDG_CONFIG_HOME = ($env.HOME | path join ".config")
$env.XDG_DATA_HOME = ($env.HOME | path join ".local" "share")
$env.XDG_STATE_HOME = ($env.HOME | path join ".local" "state")

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

# OpenCode
$env.OPENCODE_EXPERIMENTAL_LSP_TOOL = "1"
$env.OPENCODE_ENABLE_EXA = "1"

# Script search path (must be set here so config.nu can `source` from scripts/)
$env.NU_LIB_DIRS = [
    ($env.XDG_CONFIG_HOME | path join "nushell" "scripts")
]

# Extra PATH entries — must be set before mise captures its baseline
$env.PATH = ($env.PATH | prepend [
    ($env.HOME | path join ".local" "bin")
    ($env.HOME | path join ".local" "share" "omarchy" "bin")
    ($env.HOME | path join "code" "dotfiles")
    ($env.CARGO_HOME | path join "bin")
    ($env.BUN_INSTALL | path join "bin")
])

# Generate cached init scripts for tools that need `source` in config.nu.
# These MUST exist before config.nu is parsed (source is parse-time).
let cache_dir = ($env.XDG_CACHE_HOME | path join "nushell")
mkdir $cache_dir

# mise
let mise_cache = ($cache_dir | path join "mise-init.nu")
if not ($mise_cache | path exists) {
    if (which mise | is-not-empty) {
        mise activate nu | save --force $mise_cache
    } else {
        "" | save --force $mise_cache
    }
}

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
