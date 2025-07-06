# Path Configuration
set -l machine_name (uname)
fish_add_path -g \
    /opt/homebrew/bin \
    /home/linuxbrew/.linuxbrew/bin \
    /usr/local/sbin \
    $HOME/.local/bin \
    $HOME/.cargo/bin \
    $HOME/.npm-global/bin \
    $HOME/.nimble/bin \
    $HOME/.dotnet/bin \
    $(go env GOPATH)/bin \
    $HOME/.local/share/mise/shims

# OS-specific paths
if test $machine_name = Darwin
    fish_add_path -g \
        "$HOME/Library/Application Support/JetBrains/Toolbox/scripts" \
        /Applications/Ghostty.app/Contents/MacOS
    set -gx DOTNET_ROOT /opt/homebrew/opt/dotnet/libexec
end

# Environment Variables
set -gx XDG_CACHE_HOME $HOME/.cache
set -gx XDG_CONFIG_HOME $HOME/.config
set -gx XDG_DATA_HOME $HOME/.local/share
set -gx XDG_STATE_HOME $HOME/.local/state
set -gx EDITOR nvim
set -gx CARGO_HOME $XDG_DATA_HOME/cargo
set -gx PNPM_HOME $HOME/Library/pnpm
set -gx GPG_TTY (tty)
set -gx RUST_WITHOUT rust-docs
set -gx JJ_CONFIG $XDG_CONFIG_HOME/jj/config.toml
set -gx BUN_INSTALL $HOME/.bun

# OS-specific environment
if test $machine_name = Darwin
    set -gx TERM xterm-256color
end

# Path additions that depend on environment variables
fish_add_path -g \
    $PNPM_HOME \
    $CARGO_HOME/bin \
    $BUN_INSTALL/bin

# General Settings
set -U fish_greeting ""  # Universal variable to persist greeting removal

# Aliases
alias cl='clear'
alias ..='cd ..'
alias ls='lsd'
alias cat='bat'
alias cd='z'
alias vim='nvim'
alias lg='lazygit'

# Git Aliases
alias gbra='git branch'
alias gdif='git diff --no-prefix'
alias glog='git log --color --oneline'
alias gst='git status'
alias gwl='git worktree list'
alias gwa='git worktree add'
alias gwr='git worktree remove'
alias gwp='git worktree prune'

# Initialization
zoxide init fish | source
COMPLETE=fish jj | source
fish_ssh_agent

# Hydro Prompt Configuration
set -g hydro_color_pwd ebbcba
set -g hydro_color_jj c4a7e7
set -g hydro_color_error eb6f92
set -g hydro_color_prompt 9ccfd8
set -g hydro_color_duration c4a7e7
set -g hydro_multiline true
set -g hydro_symbol_prompt "➜"
set -g hydro_symbol_jj_conflict "💥"
set -g hydro_symbol_jj_divergent "🚧"
set -g hydro_symbol_jj_hidden "👻"
set -g hydro_symbol_jj_immutable "🔒"
