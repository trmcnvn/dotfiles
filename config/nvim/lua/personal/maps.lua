local M = require("utils.keymaps")

-- Helper function to reduce repetition for centering
local function map_with_center(mode, lhs, rhs, opts)
	opts = opts or {}
	opts.silent = true
	M[mode](lhs, rhs .. "zz", opts)
end

-- General settings
M.n("<Space>", "<Nop>", { silent = true, desc = "Disable space" })
M.v("<Space>", "<Nop>", { silent = true, desc = "Disable space in visual" })

-- Word wrap navigation
M.n("k", "v:count == 0 ? 'gk' : 'k'", { expr = true, silent = true, desc = "Move up with wrap" })
M.n("j", "v:count == 0 ? 'gj' : 'j'", { expr = true, silent = true, desc = "Move down with wrap" })
M.n("<down>", "v:count == 0 ? 'gj' : 'j'", { expr = true, silent = true, desc = "Arrow down with wrap" })
M.n("<up>", "v:count == 0 ? 'gk' : 'k'", { expr = true, silent = true, desc = "Arrow up with wrap" })

-- Editing
M.n("<D-a>", function()
	vim.api.nvim_command("normal! ggVG")
end, { desc = "Select all" })
M.n("<D-s>", "<cmd>w!<CR>", { desc = "Force save" })
M.n("U", "<C-r>", { desc = "Redo" })
M.x("p", 'p:let @+=@0<CR>:let @"=@0<CR>', { silent = true, desc = "Paste without overwriting register" })

-- Buffer and window management
M.n("te", "<cmd>enew<CR>", { desc = "New buffer" })
M.n("zv", "<cmd>vsplit<CR>", { desc = "Vertical split" })
M.n("zh", "<cmd>split<CR>", { desc = "Horizontal split" })
M.e("z<left>", "<C-w>h", { desc = "Move to left window" })
M.e("z<up>", "<C-w>k", { desc = "Move to upper window" })
M.e("z<down>", "<C-w>j", { desc = "Move to lower window" })
M.e("z<right>", "<C-w>l", { desc = "Move to right window" })

-- Navigation with centering
map_with_center("n", "<C-d>", "<C-d>", { desc = "Scroll down and center" })
map_with_center("n", "<C-u>", "<C-u>", { desc = "Scroll up and center" })
map_with_center("n", "n", "n", { desc = "Next search result and center" })
map_with_center("n", "N", "N", { desc = "Previous search result and center" })
map_with_center("n", "G", "G", { desc = "Go to bottom and center" })
map_with_center("n", "gg", "gg", { desc = "Go to top and center" })
map_with_center("n", "gd", "gd", { desc = "Go to definition and center" })

-- Terminal
M.n("<leader>t", function()
	require("lazy.util").float_term("fish", { border = "single" })
end, { desc = "Open floating terminal" })

-- Quick search/replace
M.n("S", function()
	local current_word = vim.fn.expand("<cword>")
	vim.ui.input({ prompt = "Replace '" .. current_word .. "' with: ", default = current_word }, function(input)
		if input then
			vim.cmd(string.format("%%s/%s/%s/gI", current_word, input))
		end
	end)
end, { desc = "Quick replace word under cursor" })

-- Open link under cursor
M.n("gx", ":sil !open <cWORD><CR>", { silent = true, desc = "Open URL under cursor" })
