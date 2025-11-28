# Mise
mise activate fish | source

# Path Configuration
set -l machine_name (uname)
fish_add_path -g \
    $HOME/.local/bin \
    $HOME/go/bin \
    $HOME/.local/share/omarchy/bin

# OS-specific paths
if test $machine_name = Darwin
    fish_add_path -g \
        /opt/homebrew/bin \
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
set -gx SUDO_EDITOR nvim
set -gx RUST_WITHOUT rust-docs
set -gx CARGO_HOME $XDG_DATA_HOME/cargo
set -gx GPG_TTY (tty)
set -gx JJ_CONFIG $XDG_CONFIG_HOME/jj/config.toml
set -gx RIPGREP_CONFIG_PATH $XDG_CONFIG_HOME/ripgrep/config
set -gx PNPM_HOME $HOME/.pnpm
set -gx BUN_INSTALL $HOME/.bun
set -gx BAT_THEME ansi

# Path additions that depend on environment variables
fish_add_path -g \
    $PNPM_HOME \
    $CARGO_HOME/bin \
    $BUN_INSTALL/bin

# Aliases
alias cl='clear'
alias ..='cd ..'
alias cat='bat'
alias cd='z'
alias vim='nvim'
alias vi='nvim'
alias ls='eza -lh --group-directories-first --icons=auto'
alias lt='eza --tree --level=2 --long --icons --git'
alias ff="fzf --preview 'bat --style=numbers --color=always {}'"

# Initialization
zoxide init fish | source
fish_ssh_agent

# Hydro Prompt Configuration
set -g hydro_color_pwd ebbcba
set -g hydro_color_jj c4a7e7
set -g hydro_color_error eb6f92
set -g hydro_color_prompt 9ccfd8
set -g hydro_color_duration c4a7e7
set -g hydro_multiline true
set -g hydro_symbol_prompt "\e[1;38;2;165;214;167m❯\e[1;38;2;255;245;157m❯\e[1;38;2;255;171;145m❯\e[0m"
set -g hydro_symbol_jj_conflict "💥"
set -g hydro_symbol_jj_divergent "🚧"
set -g hydro_symbol_jj_hidden "👻"
set -g hydro_symbol_jj_immutable "🔒"
