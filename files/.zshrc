# homebrew
if [[ "$OSTYPE" == "linux-gnu" ]]; then
  umask 002
  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
  export PATH="$HOME/.fnm:$PATH"
fi
if type brew &>/dev/null; then
  FPATH=$(brew --prefix)/share/zsh/site-functions:$FPATH
fi
autoload -Uz compinit; compinit

# version managers
# fnm
eval "$(fnm env --multi)"
eval "$(rbenv init -)"

# antibody (plugins)
source ~/.zsh_plugins.sh

# Path
export PATH="/usr/local/sbin:$PATH"
export PATH="$HOME/.cargo/bin:$PATH"
export PATH="$PATH:`yarn global bin`"

# Aliases
alias cl=clear
alias git=hub
alias ..="cd .."
alias gbra="git branch"
alias gdif="git diff --no-prefix"
alias glog="git log --color --oneline"
alias gst="git status"
alias ls="lsd"

# ENV
export EDITOR="code --wait"

# Misc
unsetopt nomatch
