# Load antibody plugins
source ~/.zsh_plugins.sh

# Path
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

# fnm (node version manager)
eval "$(fnm env --multi)"
