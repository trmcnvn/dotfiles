require "fileutils"

TABLE = {
  "~/.gitconfig" => "files/.gitconfig",
  "~/.gitexcludes" => "files/.gitexcludes",
  "~/.gitignore" => "files/.gitignore",
  "~/.config/starship.toml" => "files/starship.toml",
  "~/.config/kitty/kitty.conf" => "files/kitty.conf",
  "~/.config/kitty/tokyo-night.conf" => "files/kitty/tokyo-night.conf",
  "~/.config/fish/config.fish" => "files/config.fish",
  "~/.config/fish/functions/fish_ssh_agent.fish" => "files/fish/functions/fish_ssh_agent.fish",
  "~/.config/nvim/init.lua" => "files/nvim/init.lua",
  "~/.config/nvim/lua/personal/set.lua" => "files/nvim/lua/personal/set.lua",
  "~/.config/nvim/lua/personal/packer.lua" => "files/nvim/lua/personal/packer.lua",
  "~/.config/nvim/lua/personal/coq.lua" => "files/nvim/lua/personal/coq.lua",
  "~/.config/nvim/lua/personal/keymaps.lua" => "files/nvim/lua/personal/keymaps.lua",
  "~/.config/nvim/lua/personal/lsp.lua" => "files/nvim/lua/personal/lsp.lua",
  "~/.config/nvim/lua/personal/tree.lua" => "files/nvim/lua/personal/tree.lua"
}.inject({}) do |result, (key, value)|
  result.merge(File.expand_path(key) => File.expand_path(value))
end

TABLE.each do |dest, source|
  FileUtils.ln_s(source, dest, force: true)
end
