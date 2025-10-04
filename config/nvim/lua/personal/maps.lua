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

-- Editing and text manipulation
M.n("<C-a>", function()
	vim.api.nvim_command("normal! ggVG")
end, { desc = "Select all" })
M.n("<C-s>", ":write!<CR>", { desc = "Force save" })
M.n("<leader>s", ":write!<CR>", { desc = "Force save" })
M.x("p", '"_dP', { desc = "Paste without overwriting register" })

-- Buffer and window management
M.n("te", "<cmd>enew<CR>", { desc = "New buffer" })
M.n("<leader>ba", "<cmd>%bd|e#<CR>", { desc = "Delete all buffers except current" })

-- Window management
M.n("zv", "<cmd>vsplit<CR>", { desc = "Vertical split" })
M.n("zh", "<cmd>split<CR>", { desc = "Horizontal split" })
M.e("z<left>", "<C-w>h", { desc = "Move to left window" })
M.e("z<up>", "<C-w>k", { desc = "Move to upper window" })
M.e("z<down>", "<C-w>j", { desc = "Move to lower window" })
M.e("z<right>", "<C-w>l", { desc = "Move to right window" })

-- Line movement
M.n("<A-down>", ":m .+1<CR>==", { desc = "Move line down" })
M.n("<A-up>", ":m .-2<CR>==", { desc = "Move line up" })
M.v("<A-down>", ":m '>+1<CR>gv=gv", { desc = "Move selection down" })
M.v("<A-up>", ":m '<-2<CR>gv=gv", { desc = "Move selection up" })

-- Indentation
M.v("<", "<gv", { desc = "Indent left and reselect" })
M.v(">", ">gv", { desc = "Indent right and reselect" })

-- Clear search highlighting
M.n("<Esc>", "<cmd>nohlsearch<CR>", { desc = "Clear search highlighting" })

-- Navigation with centering
map_with_center("n", "<C-d>", "<C-d>", { desc = "Scroll down and center" })
map_with_center("n", "<C-u>", "<C-u>", { desc = "Scroll up and center" })
map_with_center("n", "n", "n", { desc = "Next search result and center" })
map_with_center("n", "N", "N", { desc = "Previous search result and center" })
map_with_center("n", "G", "G", { desc = "Go to bottom and center" })
map_with_center("n", "gg", "gg", { desc = "Go to top and center" })

-- Open link under cursor
M.n("gx", function()
	local url = vim.fn.expand("<cWORD>")
	local cmd
	if vim.fn.has("mac") == 1 then
		cmd = "open"
	elseif vim.fn.has("unix") == 1 then
		cmd = "xdg-open"
	elseif vim.fn.has("win32") == 1 then
		cmd = "start"
	else
		vim.notify("Unsupported platform for opening URLs", vim.log.levels.ERROR)
		return
	end
	vim.fn.system(cmd .. " " .. vim.fn.shellescape(url))
end, { desc = "Open URL under cursor" })

-- LSP
M.n("gh", '<cmd>lua vim.lsp.buf.hover({ border = "single" })<cr>', { desc = "Show hover information" })
M.n("gn", "<cmd>lua vim.lsp.buf.rename()<cr>", { desc = "Rename symbol" })
M.n("df", "<cmd>lua vim.diagnostic.open_float()<cr>", { desc = "Show diagnostic float" })
M.n("ca", "<cmd>lua vim.lsp.buf.code_action()<cr>", { desc = "Code actions" })
M.n("gD", "<cmd>lua vim.lsp.buf.declaration()<cr>", { desc = "Go to declaration" })
M.n("K", "<cmd>lua vim.lsp.buf.signature_help()<cr>", { desc = "Signature help" })
M.n("[d", "<cmd>lua vim.diagnostic.goto_prev()<cr>", { desc = "Previous diagnostic" })
M.n("]d", "<cmd>lua vim.diagnostic.goto_next()<cr>", { desc = "Next diagnostic" })
