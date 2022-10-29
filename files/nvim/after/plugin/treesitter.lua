local status, ts = pcall(require, "nvim-treesitter.configs")
if (not status) then return end

ts.setup({
  highlight = {
    enable = true,
    disable = {}
  },
  indent = {
    enable = true,
    disable = {}
  },
  ensure_installed = {
    "typescript",
    "toml",
    "fish",
    "json",
    "yaml",
    "css",
    "html",
    "lua",
    "svelte",
    "go",
    "ruby",
    "rust"
  },
  autotag = {
    enable = true
  }
})
