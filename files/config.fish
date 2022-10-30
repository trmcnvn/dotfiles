if status is-interactive
    # Commands to run in interactive sessions can go here
end

# Fish
set -U fish_greeting ""

# Kitty
if set -q KITTY_INSTALLATION_DIR
    set --global KITTY_SHELL_INTEGRATION enabled
    source "$KITTY_INSTALLATION_DIR/shell-integration/fish/vendor_conf.d/kitty-shell-integration.fish"
    set --prepend fish_complete_path "$KITTY_INSTALLATION_DIR/shell-integration/fish/vendor_completions.d"
end

# asdf
source /opt/homebrew/opt/asdf/libexec/asdf.fish
# zoxide
zoxide init fish | source
# Starship
starship init fish | source

# Aliases
alias cl=clear
alias ..="cd .."
alias gbra="git branch"
alias gdif="git diff --no-prefix"
alias glog="git log --color --oneline"
alias gst="git status"
alias ls="lsd"
alias cat="bat"
alias lg="lazygit"
alias cd="z"

# ENV
set -U EDITOR "nvim"
set -U PNPM_HOME "~/Library/pnpm"
set -U fish_user_paths $PNPM_HOME $fish_user_paths
set -U fish_user_paths /usr/local/sbin $fish_user_paths
set -U fish_user_paths $HOME/.cargo/bin $fish_user_paths
set -U fish_user_paths /opt/homebrew/bin $fish_user_paths
set -U fish_user_paths "$HOME/Library/Application Support/JetBrains/Toolbox/scripts" $fish_user_paths

# Fish functions
fish_ssh_agent
