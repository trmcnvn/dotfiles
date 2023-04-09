local status, neotree = pcall(require, "neo-tree")
if (not status) then return end

neotree.setup({
  close_if_last_window = true,
})

local M = require("utils.keymaps")
M.n("<leader>b", "<cmd>Neotree toggle<CR>")
