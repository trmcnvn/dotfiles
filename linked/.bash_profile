export PATH="$HOME/.rbenv/bin:$PATH"
eval "$(rbenv init -)"

export GOPATH=$HOME/code/go
export PATH="$GOPATH/bin:$PATH"

export PORT=3000

alias glog="git log --color --oneline"
alias gbra="git branch"
alias gst="git status"
alias gdif="git diff --no-prefix"
alias bi="bundle install"
alias bx="bundle exec"
alias ..="cd .."
alias ~="cd ~"
alias la="ls -a"
alias lla="ls -la"
alias cl="clear"

function gep {
  git push $* origin $(git-branch)
}

function gepl {
  git pull --rebase $* origin $(git-branch)
}

function git-branch {
  git branch 2> /dev/null | grep -e '\* ' | sed 's/^..\(.*\)/\1 /'
}

red="\033[31m"
green="\033[32m"
blue="\033[36m"
reset="\033[0m"
bold="\033[1m"
prompt_char="♥"

function prompt-full {
  PS1="\[\033[G\]\[$bold\]\[$green\]\w \[$blue\]\$(git-branch)\[$red\]\[$bold\]$prompt_char \[$reset\]"
}

function prompt-min {
  PS1="\[\033[G\]\[$bold\]\[$blue\]\$(git-branch)\[$red\]\[$bold\]$prompt_char \[$reset\]"
}

prompt-full
