# homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew update
brew upgrade
brew_apps=(
  asdf
  bat
  doctl
  docker
  fish
  gh
  git
  git-crypt
  git-secret
  helm
  helmfile
  imagemagick
  kustomize
  lazygit
  overmind
  postgresql@14
  redis
  ripgrep
  rustup-init
  ruby-build
  starship
  tokei
  zoxide
  fzf
)
brew install "${brew_apps[@]}"
brew tap homebrew/cask-versions
brew_casks=(
  alfred
  visual-studio-code
  kitty
  ticktick
  linear-linear
  notion
  discord
  bitwarden
  google-chrome
  firefox-developer-edition
  spotify
  telegram
  zoom
)
brew install --cask "${brew_casks[@]}"

# fish shell
echo $(brew --prefix fish)/bin/fish | sudo tee -a /etc/shells
chsh -s $(brew --prefix fish)/bin/fish

# asdf
asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git
asdf plugin add ruby https://github.com/asdf-vm/asdf-ruby.git
asdf install nodejs lts
asdf install ruby 2.7.6
asdf install ruby latest
asdf global nodejs lts
asdf global ruby latest