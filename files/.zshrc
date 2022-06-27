# Fig pre-block
[[ -f "$HOME/.fig/shell/zshrc.pre.zsh" ]] && . "$HOME/.fig/shell/zshrc.pre.zsh"

# Homebrew
if type brew &>/dev/null; then
  FPATH=$(brew --prefix)/share/zsh/site-functions:$FPATH
fi
autoload -Uz compinit; compinit

# kitty
if type kitty &>/dev/null; then
  kitty + complete setup zsh | source /dev/stdin
fi

# version managers
# nvm
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh"
[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && . "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"
# rbenv
eval "$(rbenv init -)"

# antibody (plugins)
source ~/.zsh_plugins.sh

# Path
export PATH="/usr/local/sbin:$PATH"
export PATH="$HOME/.cargo/bin:$PATH"

# Aliases
alias cl=clear
alias ..="cd .."
alias gbra="git branch"
alias gdif="git diff --no-prefix"
alias glog="git log --color --oneline"
alias gst="git status"
alias ls="lsd"
alias lg="lazygit"

# ENV
export EDITOR="code --wait"

# Misc
unsetopt nomatch

# Starship
eval "$(starship init zsh)"

# Fig post-block
[[ -f "$HOME/.fig/shell/zshrc.post.zsh" ]] && . "$HOME/.fig/shell/zshrc.post.zsh"
