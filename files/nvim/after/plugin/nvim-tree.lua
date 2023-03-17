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
  },
  trash = { cmd = "trash" },
  view = {
    mappings = {
      list = {
        { key = "d", action = "trash" },
        { key = "D", action = "remove" }
      }
    }
  },
  renderer = {
    indent_width = 1,
  }
}

local M = require("utils.keymaps")
M.n("<leader>p", ":NvimTreeToggle<CR>")
