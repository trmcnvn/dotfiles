if status is-interactive
    # Commands to run in interactive sessions can go here
end

# Homebrew
fish_add_path /opt/homebrew/bin
fish_add_path /home/linuxbrew/.linuxbrew/bin

# Fish
set fish_greeting
set -g theme_color_scheme terminal-dark
set -g fish_prompt_pwd_dir_length 3
set -g theme_display_user yes
set -g theme_hide_hostname no
set -g theme_hostname always

# asdf
source $(brew --prefix asdf)/libexec/asdf.fish
# zoxide
zoxide init fish | source
# Starship
starship init fish | source
# Opam (OCaml)
test (uname) = Darwin; and eval $(opam env)

# Aliases
alias cl=clear
alias ..="cd .."
alias gbra="git branch"
alias gdif="git diff --no-prefix"
alias glog="git log --color --oneline"
alias gst="git status"
alias gwl="git worktree list"
alias gwa="git worktree add"
alias gwr="git worktree remove"
alias gwp="git worktree prune"
alias ls="lsd"
alias cat="bat"
alias lg="lazygit"
alias cd="z"
alias vim="nvim"

# ENV
set -gx XDG_CACHE_HOME $HOME/.cache
set -gx XDG_CONFIG_HOME $HOME/.config
set -gx XDG_DATA_HOME $HOME/.local/share
set -gx XDG_STATE_HOME $HOME/.local/state
set -gx EDITOR "nvim"
set -gx PNPM_HOME $HOME/Library/pnpm
set -gx DOTNET_ROOT "/opt/homebrew/opt/dotnet/libexec"
set -gx GPG_TTY $(tty)
set -gx CARGO_HOME $XDG_DATA_HOME/cargo
set -gx RUST_WITHOUT rust-docs
test (uname) = Darwin; and set -gx TERM xterm-256color

set -gx fish_user_paths $PNPM_HOME $fish_user_paths
set -gx fish_user_paths /usr/local/sbin $fish_user_paths
set -gx fish_user_paths $HOME/.cargo/bin $fish_user_paths
test (uname) = Darwin; and set -gx fish_user_paths "$HOME/Library/Application Support/JetBrains/Toolbox/scripts" $fish_user_paths
set -gx fish_user_paths $HOME/.npm-global/bin $fish_user_paths
set -ga fish_user_paths $HOME/.nimble/bin
set -ga fish_user_paths $HOME/.dotnet/tools
fish_add_path $CARGO_HOME/bin
fish_add_path $(go env GOPATH)/bin
fish_add_path $HOME/.local/bin

# Fish functions
fish_ssh_agent

# bun
set --export BUN_INSTALL "$HOME/.bun"
set --export PATH $BUN_INSTALL/bin $PATH
