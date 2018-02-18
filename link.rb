require "fileutils"

TABLE = {
  "~/.gemrc" => "linked/.gemrc",
  "~/.gitconfig" => "linked/.gitconfig",
  "~/.gitexcludes" => "linked/.gitexcludes",
  "~/.gitignore" => "linked/.gitignore",
  "~/.inputrc" => "linked/.inputrc",
  "~/.pryrc" => "linked/.pryrc",
  "~/.rbenv/default-gems" => "linked/.rbenv/default-gems",
  "~/.rspec" => "linked/.rspec",
  "~/.bash_profile" => "linked/.bash_profile",
  "~/.zshrc" => "linked/.zshrc"
}.inject({}) do |result, (key, value)|
  result.merge(File.expand_path(key) => File.expand_path(value))
end

def install
  system("git pull")
  TABLE.each do |dest, source|
    File.symlink(source, dest) rescue nil
  end
end

def uninstall
  FileUtils.rm(TABLE.keys)
end
