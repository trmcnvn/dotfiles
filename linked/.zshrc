#
# Executes commands at the start of an interactive session.
#
# Authors:
#   Sorin Ionescu <sorin.ionescu@gmail.com>
#

# Source Prezto.
if [[ -s "${ZDOTDIR:-$HOME}/.zprezto/init.zsh" ]]; then
  source "${ZDOTDIR:-$HOME}/.zprezto/init.zsh"
fi

# Customize to your needs...
export PATH="$HOME/.rbenv/bin:$PATH"
eval "$(rbenv init -)"

export PORT=3000
export GOPATH="$HOME/code/go"

alias cl="clear"
alias glog="git log --color --oneline"
alias gdif="git diff --no-prefix"
alias gst="git status"
alias gbra="git branch"
