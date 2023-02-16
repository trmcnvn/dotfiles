local status, tree = pcall(require, "nvim-tree")
if (not status) then return end

tree.setup {
  diagnostics = {
    enable = true,
  },
  modified = {
    enable = true,
  },
  sync_root_with_cwd = true,
  update_focused_file = {
    enable = true,
  },
  git = {
    ignore = false
  }
}

local M = require("utils.keymaps")
M.n("<leader>p", ":NvimTreeToggle<CR>")
