require "fileutils"

TABLE = {
  "~/.gitconfig" => "files/.gitconfig",
  "~/.gitexcludes" => "files/.gitexcludes",
  "~/.gitignore" => "files/.gitignore",
  "~/.zshrc" => "files/.zshrc",
  "~/.zsh_plugins.txt" => "files/.zsh_plugins.txt",
  "~/.config/starship.toml" => "files/starship.toml",
}.inject({}) do |result, (key, value)|
  result.merge(File.expand_path(key) => File.expand_path(value))
end

def install_latest
  system("git pull")
  install
end

def install
  TABLE.each do |dest, source|
    FileUtils.ln_s(source, dest, force: true)
  end
end

def uninstall
  FileUtils.rm(TABLE.keys)
end
