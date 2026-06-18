# XDG Base Directories — set early so child processes (nushell, etc.) inherit them
export XDG_CACHE_HOME="$HOME/.cache"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_STATE_HOME="$HOME/.local/state"

# Tool paths for login shells spawned by GUI apps like Zed.
export CARGO_HOME="$XDG_DATA_HOME/cargo"
export BUN_INSTALL="$HOME/.bun"

_path_prepend() {
  case ":$PATH:" in
    *":$1:"*) ;;
    *) PATH="$1${PATH:+":$PATH"}" ;;
  esac
}

_path_prepend "$BUN_INSTALL/bin"
_path_prepend "$CARGO_HOME/bin"
_path_prepend "$HOME/Code/dotfiles"
_path_prepend "$HOME/.local/bin"
export PATH
unset -f _path_prepend

if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate bash)"
fi
