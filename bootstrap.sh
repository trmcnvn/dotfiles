#!/bin/sh

# homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval $(/opt/homebrew/bin/brew shellenv)
brew update
brew upgrade
brew_apps=(
  asdf
  bat
  doctl
  docker
  dust
  fish
  gh
  git
  git-crypt
  git-secret
  gnupg
  helm
  helmfile
  imagemagick
  jq
  kustomize
  lazygit
  overmind
  postgresql@14
  redis
  ripgrep
  ruby-build
  starship
  tokei
  zoxide
  fzf
  fd
  nvim
)
brew install "${brew_apps[@]}"
brew tap homebrew/cask-versions
brew tap wez/wezterm
brew_casks=(
  raycast
  ticktick
  linear-linear
  notion
  discord
  slack
  bitwarden
  google-chrome
  zoom
  kap
  wez/wezterm/wezterm
  dash
  numi
  iina
  figma
  textmate
)
brew install --cask "${brew_casks[@]}"

# fish shell
echo $(brew --prefix fish)/bin/fish | sudo tee -a /etc/shells
chsh -s $(brew --prefix fish)/bin/fish

# dotfiles
find "$(pwd)/config" -type f -print0 | while IFS= read -r -d '' file; do
  rel_path="${file#$(pwd)/config}"
  mkdir -p "$HOME/.config/$(dirname "$rel_path")"
  ln -sf "$file" "$HOME/.config$rel_path"
done

find "$(pwd)/home" -type f -print0 | while IFS= read -r -d '' file; do
  filename=$(basename "$file")
  ln -sf "$file" "$HOME/$filename"
done

# asdf
asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git
asdf plugin add ruby https://github.com/asdf-vm/asdf-ruby.git
asdf plugin add rust https://github.com/asdf-community/asdf-rust.git
asdf plugin add zig https://github.com/asdf-community/asdf-zig.git
asdf plugin add deno https://github.com/asdf-community/asdf-deno.git
asdf plugin add golang https://github.com/kennyp/asdf-golang.git

asdf install ruby lastest
asdf install nodejs lts
asdf install rust latest
asdf install zig latest
asdf install deno latest
asdf install golang latest

asdf global ruby latest
asdf global nodejs lts
asdf global zig latest
asdf global rust latest
asdf global deno latest
asdf global golang latest

# defaults
set +e
sudo -v
osascript -e 'tell application "System Preferences" to quit'
# Keyboard key-repeat
defaults write -g ApplePressAndHoldEnabled -bool false
defaults write NSGlobalDomain KeyRepeat -int 2
defaults write NSGlobalDomain InitialKeyRepeat -int 15
# Apple "Dashboard"
defaults write com.apple.dashboard mcx-disabled -bool true
# Stupid "smart" characters
defaults write NSGlobalDomain NSAutomaticQuoteSubstitutionEnabled -bool false
defaults write NSGlobalDomain NSAutomaticDashSubstitutionEnabled -bool false
defaults write NSGlobalDomain NSAutomaticSpellingCorrectionEnabled -bool false
# Mouse/pad speed
defaults write -g com.apple.trackpad.scaling 2
defaults write -g com.apple.mouse.scaling 2.5
# .DSStore
defaults write com.apple.desktopservices DSDontWriteNetworkStores -bool true
# Warnings
defaults write com.apple.LaunchServices LSQuarantine -bool false
# Display
defaults write NSGlobalDomain AppleInterfaceStyle -string "Dark"
defaults write NSGlobalDomain AppleAquaColorVariant -int 6
defaults write NSGlobalDomain AppleHighlightColor -string "0.847059 0.847059 0.862745"
defaults write com.apple.menuextra.battery ShowPercent -bool true
defaults write NSGlobalDomain NSTableViewDefaultSizeMode -int 1
defaults write NSGlobalDomain NSDocumentSaveNewDocumentsToCloud -bool false
# Finder
defaults write com.apple.finder _FXShowPosixPathInTitle -bool true
defaults write com.apple.finder FXEnableExtensionChangeWarning -bool false
defaults write com.apple.finder _FXSortFoldersFirst -bool true
defaults write com.apple.finder FXDefaultSearchScope -string "SCcf"
defaults write com.apple.finder CreateDesktop false
# Photos
defaults -currentHost write com.apple.ImageCapture disableHotPlug -bool true
# Chrome
defaults write com.google.Chrome AppleEnableSwipeNavigateWithScrolls -bool false
# Dock
defaults write com.apple.dock mru-spaces -bool false
defaults write com.apple.dock tilesize -int 45
defaults write com.apple.dock expose-animation-duration -float 0.1
defaults write com.apple.dock "expose-group-by-app" -bool true
defaults write com.apple.dock autohide-delay -float 0
defaults write com.apple.dock autohide-time-modifier -float 0
defaults write com.apple.dock autohide -bool true
defaults write com.apple.dock launchanim -bool false
defaults write com.apple.dock show-recents -bool false
defaults write com.apple.dock persistent-apps -array
defaults write com.apple.dock static-only -bool true
# Screencapture
defaults write com.apple.screencapture disable-shadow -bool true
defaults write com.apple.screencapture location ~/Downloads
for app in "Activity Monitor" "Address Book" "Calendar" "Contacts" "cfprefsd" \
	"Dock" "Finder" "Mail" "Messages" "Safari" "SystemUIServer" \
	"Terminal" "Photos"; do
	killall "$app" >/dev/null 2>&1
done
set -e
