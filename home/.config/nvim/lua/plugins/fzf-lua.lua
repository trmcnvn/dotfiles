return {
	pack = { src = "https://github.com/ibhagwan/fzf-lua" },
	config = function()
		local height = math.floor(0.618 * vim.o.lines)
		local width = math.floor(0.618 * vim.o.columns)
		require("fzf-lua").setup({
			winopts = {
				height = height,
				width = width,
				row = math.floor(0.5 * (vim.o.lines - height)),
				col = math.floor(0.5 * (vim.o.columns - width)),
				preview = {
					default = "bat",
					hidden = true,
				},
			},
			actions = {
				files = {
					true,
					["ctrl-q"] = {
						fn = FzfLua.actions.file_sel_to_qf,
						prefix = "select-all+",
					},
				},
			},
		})

		local M = require("utils.keymaps")
		M.n("<leader>f", "<cmd>FzfLua files<cr>", { desc = "find files" })
		M.n("<leader>r", "<cmd>FzfLua live_grep_native<cr>", { desc = "live search" })
		M.n("<leader>o", "<cmd>FzfLua oldfiles<cr>", { desc = "recent files" })
		M.n("<leader>df", function()
			FzfLua.files({ cwd = vim.fn.expand("$HOME/code/dotfiles") })
		end, { desc = "dotfiles" })
	end,
}
