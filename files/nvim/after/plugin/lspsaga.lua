local status, saga = pcall(require, "lspsaga")
if (not status) then return end

saga.init_lsp_saga({
  code_action_icon = "",
  code_action_lightbulb = {
    enable = true,
    enable_in_insert = true,
    virtual_text = false,
  }
})

local M = require("utils.keymaps")
local opts = { silent = true }
M.n("gd", "<cmd>Lspsaga lsp_finder<CR>", opts)
M.n("gp", "<cmd>Lspsaga peek_definition<CR>", opts)
M.n("gr", "<cmd>Lspsaga rename<CR>", opts)
M.n("<C-k>", "<cmd>Lspsaga signature_help<CR>", opts)
M.n("<C-j>", "<cmd>Lspsaga diagnostic_jump_next<CR>", opts)
M.n("K", "<cmd>Lspsaga hover_doc<CR>", opts)
M.n("ga", "<cmd>Lspsaga code_action<CR>", opts)
