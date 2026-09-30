
eval "$(/opt/homebrew/bin/brew shellenv zsh)"

# Also provide the shared environment to noninteractive login shells.
[ -r "$HOME/.config/shell/env.sh" ] && . "$HOME/.config/shell/env.sh"
