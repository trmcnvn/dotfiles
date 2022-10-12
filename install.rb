require "fileutils"

TABLE = {
  "~/.gitconfig" => "files/.gitconfig",
  "~/.gitexcludes" => "files/.gitexcludes",
  "~/.gitignore" => "files/.gitignore",
  "~/.config/starship.toml" => "files/starship.toml",
  "~/.config/kitty/kitty.conf" => "files/kitty.conf",
  "~/.config/kitty/tokyo-night.conf" => "files/kitty/tokyo-night.conf",
  "~/.config/fish/config.fish" => "files/config.fish",
  "~/.config/fish/functions/fish_ssh_agent.fish" => "files/fish/functions/fish_ssh_agent.fish"
}.inject({}) do |result, (key, value)|
  result.merge(File.expand_path(key) => File.expand_path(value))
end

TABLE.each do |dest, source|
  FileUtils.ln_s(source, dest, force: true)
end