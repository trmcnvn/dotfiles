
eval "$(/opt/homebrew/bin/brew shellenv zsh)"

# Also provide the shared environment to noninteractive login shells.
[ -r "$HOME/.config/shell/env.sh" ] && . "$HOME/.config/shell/env.sh"

# Added by OrbStack: command-line tools and integration
# This won't be added again if you remove it.
source ~/.orbstack/shell/init.zsh 2>/dev/null || :
