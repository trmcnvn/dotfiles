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
    "~/.config/fish/functions/fish_ssh_agent.fish" =>
      "files/fish/functions/fish_ssh_agent.fish",
    "~/.config/nvim/init.lua" => "files/nvim/init.lua",
    "~/.config/nvim/after" => "files/nvim/after",
    "~/.config/nvim/lua" => "files/nvim/lua",
    "~/.config/wezterm/wezterm.lua" => "files/wezterm.lua"
  }.inject({}) do |result, (key, value)|
    result.merge(File.expand_path(key) => File.expand_path(value))
  end

TABLE.each { |dest, source| FileUtils.ln_s(source, dest, force: true) }
