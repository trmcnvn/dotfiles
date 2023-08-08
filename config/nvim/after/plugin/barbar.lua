local ok, barbar = pcall(require, "bufferline")
if not ok then return end

barbar.setup {
	animation = false,
	icons = {
		button = "x",
		modified = { button = "●" },
	},
	sidebar_filetypes = {
		["neo-tree"] = { event = "BufWipeout" }
	}
}

local M = require("utils.keymaps")
M.n("<Tab>", "<cmd>BufferNext<cr>")
M.n("<S-Tab>", "<cmd>BufferPrevious<cr>")
M.n("<A-w>", "<cmd>BufferClose<cr>")
