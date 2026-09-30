# Share environment setup; keep shell-specific activation here.
[ -r "$HOME/.config/shell/env.sh" ] && . "$HOME/.config/shell/env.sh"

if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate bash)"
fi

. "$HOME/.local/share/../bin/env"
