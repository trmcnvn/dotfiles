use std/util "path add"

path add "~/.local/bin"
path add "~/.local/share/omarchy/bin"
path add "~/code/dotfiles"
path add ($env.CARGO_HOME | path join "bin")
path add ($env.BUN_INSTALL | path join "bin")

# macOS: Ghostty CLI
if (sys host).name == "Darwin" {
    path add "/Applications/Ghostty.app/Contents/MacOS"
}
