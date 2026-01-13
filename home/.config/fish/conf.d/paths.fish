set -l machine_name (uname)

fish_add_path \
    $HOME/.local/bin \
    $HOME/.local/share/omarchy/bin \
    $HOME/code/dotfiles

# OS-specific paths
if test $machine_name = Darwin
    fish_add_path /Applications/Ghostty.app/Contents/MacOS
end
