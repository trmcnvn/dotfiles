# homebrew completions
if type brew &>/dev/null; then
  FPATH=$(brew --prefix)/share/zsh/site-functions:$FPATH
fi

# version managers
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

# ENV
export EDITOR="code --wait"
