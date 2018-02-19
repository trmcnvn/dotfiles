# Custom
export NVM_DIR="$HOME/.nvm"
alias loadnvm=". $(brew --prefix nvm)/nvm.sh"

export GOPATH="$HOME/code/go"
export PATH="$GOPATH:$PATH"

export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/platform-tools

export PATH="$HOME/.yarn/bin:$PATH"

# Path to your oh-my-zsh installation.
export ZSH=/Users/vevix/.oh-my-zsh
source $ZSH/antigen/antigen.zsh

# Load oh-my-zsh
antigen use oh-my-zsh

# Bundles
antigen bundle git
antigen bundle heroku
antigen bundle iterm2
antigen bundle mix
antigen bundle rbenv

# Syntax
antigen bundle zsh-users/zsh-syntax-highlighting

# Load the theme. - Disable Spaceship until 4.0 release (async)
#export SPACESHIP_PROMPT_DEFAULT_PREFIX="w/ "
#export SPACESHIP_CHAR_SYMBOL="❯ "
#export SPACESHIP_PACKAGE_SHOW="false"
#export SPACESHIP_RUST_SYMBOL="⚙️ "
#antigen theme https://github.com/denysdovhan/spaceship-prompt spaceship
antigen bundle mafredri/zsh-async
antigen bundle sindresorhus/pure

# Tell Antigen that you're done.
antigen apply

# Aliases
alias gbra="git branch"
alias gdif="git diff --no-prefix"
alias cl="clear"