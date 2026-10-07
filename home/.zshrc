# Only interactive Zsh sessions hand off to Nushell.
[[ -o interactive ]] || return

# Login shells already initialize Homebrew in .zprofile.
if [[ ! -o login && -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv zsh)"
fi
[ -r "$HOME/.config/shell/env.sh" ] && . "$HOME/.config/shell/env.sh"

# Activate and load tool paths before handing off to Nushell.
if command -v mise >/dev/null 2>&1; then
    eval "$(mise activate zsh)"
    eval "$(mise hook-env -s zsh)"
fi

# Allow an interactive `zsh` opened from Nu to stay in Zsh.
# config.nu already sources login.nu, so avoid sourcing it again with --login.
if [[ ${DOTFILES_NU_FROM_ZSH:-0} != 1 ]] && command -v nu >/dev/null 2>&1; then
    export DOTFILES_NU_FROM_ZSH=1
    exec nu --interactive
    unset DOTFILES_NU_FROM_ZSH
fi

. "$HOME/.local/share/../bin/env"
