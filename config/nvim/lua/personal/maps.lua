local M = require("utils.keymaps")

-- Keymap defaults
M.n("<Space>", "<Nop>", { silent = true })
M.v("<Space>", "<Nop>", { silent = true })
-- Word wrap fix
M.n("k", "v:count == 0 ? 'gk' : 'k'", { expr = true, silent = true })
M.n("j", "v:count == 0 ? 'gj' : 'j'", { expr = true, silent = true })
M.n("<down>", "v:count == 0 ? 'gj' : 'j'", { expr = true, silent = true })
M.n("<up>", "v:count == 0 ? 'gk' : 'k'", { expr = true, silent = true })
-- Other
M.n("<D-a>", "gg<S-v>G") -- Select all
M.n("<D-s>", "<cmd>w!<CR>") -- Save
M.n("te", "<cmd>enew<CR>") -- New tab
M.n("zv", "<cmd>vsplit<CR>") -- Vertical split
M.n("zh", "<cmd>split<CR>") -- Horizontal split
M.e("z<left>", "<C-w>h")
M.e("z<up>", "<C-w>k")
M.e("z<down>", "<C-w>j")
M.e("z<right>", "<C-w>l")
M.n("U", "<C-r>") -- Redo
-- Center when navigating
M.n("<C-d>", "<C-d>zz")
M.n("<C-u>", "<C-u>zz")
M.n("n", "nzz")
M.n("N", "Nzz")
M.n("G", "Gzz")
M.n("gg", "ggzz")
M.n("gd", "gdzz")
-- Floating term
M.n("<leader>t", function()
	require("lazy.util").float_term("fish", { border = "single" })
end)
-- Don't overwrite paste
M.x("p", 'p:let @+=@0<CR>:let @"=@0<CR>')
-- Quick search
M.n("S", function()
	local cmd = ":%s/<C-r><C-w>/<C-r><C-w>/gI<Left><Left><Left>"
	local keys = vim.api.nvim_replace_termcodes(cmd, true, false, true)
	vim.api.nvim_feedkeys(keys, "n", false)
end)
-- Open link
M.n("gx", ":sil !open <cWORD><cr>", { silent = true })
