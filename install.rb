require "fileutils"

TABLE = {
  "~/.gitconfig" => "files/.gitconfig",
  "~/.gitexcludes" => "files/.gitexcludes",
  "~/.gitignore" => "files/.gitignore",
  "~/.config/starship.toml" => "files/starship.toml",
  "~/.config/kitty/kitty.conf" => "files/kitty.conf",
  "~/.config/fish/config.fish" => "files/config.fish"
}.inject({}) do |result, (key, value)|
  result.merge(File.expand_path(key) => File.expand_path(value))
end

TABLE.each do |dest, source|
  FileUtils.ln_s(source, dest, force: true)
end