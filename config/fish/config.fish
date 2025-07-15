# Mise
mise activate fish | source

# Path Configuration
set -l machine_name (uname)
fish_add_path -g \
    /opt/homebrew/bin \
    $HOME/.local/bin \
    $(go env GOPATH)/bin

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
set -gx RUST_WITHOUT rust-docs
set -gx CARGO_HOME $XDG_DATA_HOME/cargo
set -gx GPG_TTY (tty)
set -gx JJ_CONFIG $XDG_CONFIG_HOME/jj/config.toml
set -gx RIPGREP_CONFIG_PATH $XDG_CONFIG_HOME/ripgrep/config
set -gx PNPM_HOME $HOME/.pnpm
set -gx BUN_INSTALL $HOME/.bun

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
alias ls='exa'
alias cat='bat'
alias cd='z'
alias vim='nvim'
alias vi='nvim'

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
