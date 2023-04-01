require "fileutils"

TABLE =
  {
    "~/.gitconfig" => "files/.gitconfig",
    "~/.gitexcludes" => "files/.gitexcludes",
    "~/.gitignore" => "files/.gitignore",
    "~/.config/starship.toml" => "files/starship.toml",
    "~/.config/kitty/kitty.conf" => "files/kitty.conf",
    "~/.config/kitty/tokyo-night.conf" => "files/kitty/tokyo-night.conf",
    "~/.config/fish/config.fish" => "files/config.fish",
    "~/.config/fish/functions" => "files/fish/functions",
    "~/.config/nvim/init.lua" => "files/nvim/init.lua",
    "~/.config/nvim/after" => "files/nvim/after",
    "~/.config/nvim/lua" => "files/nvim/lua",
    "~/.config/wezterm/wezterm.lua" => "files/wezterm.lua",
    "~/.config/wezterm/lua" => "files/wezterm/lua",
    "~/Library/Application Support/lazygit/config.yml" => "files/lazygit/config.yml"
  }.inject({}) do |result, (key, value)|
    result.merge(File.expand_path(key) => File.expand_path(value))
  end

TABLE.each { |dest, source| FileUtils.ln_s(source, dest, force: true) }
