# ASCII BOAT SHELL INTEGRATION START boat
case ":$PATH:" in
  *":/Users/trmcnvn/.ascii/bin:"*) ;;
  *) PATH="/Users/trmcnvn/.ascii/bin:$PATH" ;;
esac
export PATH
# ASCII BOAT SHELL INTEGRATION END boat

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
# Zeron action terminals also stay in Zsh: Zeron types a POSIX `. "$ZERON_ACTION_SCRIPT"`.
# config.nu already sources login.nu, so avoid sourcing it again with --login.
if [[ ${DOTFILES_NU_FROM_ZSH:-0} != 1 && -z ${ZERON_ACTION_SCRIPT:-} ]] && command -v nu >/dev/null 2>&1; then
    export DOTFILES_NU_FROM_ZSH=1
    exec nu --interactive
    unset DOTFILES_NU_FROM_ZSH
fi

. "$HOME/.local/share/../bin/env"

# ASCII BOAT SHELL INTEGRATION START boat
boat() {
  current_file=$(mktemp)
  convo_file=$(mktemp)
  old_current_file=${BOAT_CURRENT_ID_FILE-}
  old_convo_file=${BOAT_CURRENT_CONVO_FILE-}
  export BOAT_CURRENT_ID_FILE="$current_file"
  export BOAT_CURRENT_CONVO_FILE="$convo_file"
  command "/Users/trmcnvn/.ascii/bin/boat" "$@"
  boat_status=$?
  if [ "$boat_status" -eq 0 ]; then
    case "${1:-}" in
      new|start|fork)
        if [ -s "$current_file" ]; then
          current_id=$(tr -d '[:space:]' < "$current_file")
          if [ -n "$current_id" ]; then export BOAT_CURRENT_ID="$current_id"; fi
        fi
        ;;
    esac
    case "${1:-}" in
      prompt)
        if [ -s "$convo_file" ]; then
          IFS= read -r current_convo < "$convo_file" || current_convo=""
          if [ -n "$current_convo" ]; then export BOAT_CURRENT_CONVO="$current_convo"; fi
        fi
        ;;
    esac
  fi
  if [ -n "$old_current_file" ]; then export BOAT_CURRENT_ID_FILE="$old_current_file"; else unset BOAT_CURRENT_ID_FILE; fi
  if [ -n "$old_convo_file" ]; then export BOAT_CURRENT_CONVO_FILE="$old_convo_file"; else unset BOAT_CURRENT_CONVO_FILE; fi
  rm -f "$current_file" "$convo_file"
  return "$boat_status"
}
# ASCII BOAT SHELL INTEGRATION END boat
