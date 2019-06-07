require "fileutils"

TABLE = {
  "~/.gitconfig" => "files/.gitconfig",
  "~/.gitexcludes" => "files/.gitexcludes",
  "~/.gitignore" => "files/.gitignore",
  "~/.zshrc" => "files/.zshrc",
  "~/.zsh_plugins.txt" => "files/.zsh_plugins.txt"
}.inject({}) do |result, (key, value)|
  result.merge(File.expand_path(key) => File.expand_path(value))
end

def install_latest
  system("git pull")
  install
end

def install
  TABLE.each do |dest, source|
    File.symlink(source, dest) rescue nil
  end
end

def uninstall
  FileUtils.rm(TABLE.keys)
end
