local ok, barbar = pcall(require, "bufferline")
if not ok then return end

barbar.setup {
	closable = true,
	animation = false,
}

vim.api.nvim_create_autocmd("FileType", {
	callback = function(tbl)
		local set_offset = require("bufferline.api").set_offset
		local bufwinid
		local last_width
		local autocmd = vim.api.nvim_create_autocmd("WinScrolled", {
			callback = function()
				bufwinid = bufwinid or vim.fn.bufwinid(tbl.buf)
				local width = vim.api.nvim_win_get_width(bufwinid)
				if width ~= last_width then
					set_offset(width, "FileTree")
					last_width = width
				end
			end,
		})

		vim.api.nvim_create_autocmd("BufWipeout", {
			buffer = tbl.buf,
			callback = function()
				vim.api.nvim_del_autocmd(autocmd)
				set_offset(0)
			end,
			once = true,
		})
	end,
	pattern = "neo-tree"
})

local M = require("utils.keymaps")
M.n("<Tab>", "<cmd>BufferNext<cr>")
M.n("<S-Tab>", "<cmd>BufferPrevious<cr>")
M.n("<A-w>", "<cmd>BufferClose<cr>")
