export PATH="$HOME/.rbenv/bin:$PATH"
eval "$(rbenv init -)"

export NVM_DIR=$HOME/.nvm
source $(brew --prefix nvm)/nvm.sh

export GOPATH=$HOME/code/go
export PATH="$GOPATH/bin:$PATH"

export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/platform-tools

alias glog="git log --color --oneline"
alias gbra="git branch"
alias gst="git status"
alias gdif="git diff --no-prefix"
alias bi="bundle install"
alias bx="bundle exec"
alias ..="cd .."
alias ~="cd ~"
alias cl="clear"
alias chrome="/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --enable-precise-memory-info"

function git-branch {
  git branch 2> /dev/null | grep -e '\* ' | sed 's/^..\(.*\)/\1 /'
}

blue="\033[38;5;111m"
green="\033[38;5;112m"
orange="\033[38;5;166m"
reset="\033[0m"
bold="\033[1m"
prompt_char="λ"

function prompt-full {
  PS1="\[\033[G\]\[$bold\]\[$orange\] $prompt_char \[$bold\]\[$green\]\W \[$blue\]\$(git-branch)\[$reset\]$ "
}

prompt-full

test -e "${HOME}/.iterm2_shell_integration.bash" && source "${HOME}/.iterm2_shell_integration.bash"

export PATH="$HOME/.yarn/bin:$PATH"
[ -f /usr/local/etc/bash_completion ] && . /usr/local/etc/bash_completion