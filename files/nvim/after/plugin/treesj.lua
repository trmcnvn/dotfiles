local status, treesj = pcall(require, "treesj")
if (not status) then return end

treesj.setup({
  use_default_keymaps = false,
  max_join_length = 150
})

local M = require("utils.keymaps")
M.n("J", "<cmd>TSJToggle<cr>")
