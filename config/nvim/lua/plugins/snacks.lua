return {
	pack = { src = "https://github.com/folke/snacks.nvim" },
	config = function()
		require("snacks").setup({
			bigfile = { enabled = true },
			bufdelete = { enabled = true },
			dashboard = {
				enabled = true,
				sections = {
					{ section = "header" },
					{ section = "keys", gap = 1, padding = 1 },
				},
			},
			input = { enabled = true },
			layout = { enabled = true },
			notify = { enabled = true },
			notifier = { enabled = true },
			rename = { enabled = true },
			terminal = {
				enabled = true,
				win = {
					style = {
						position = "float",
						backdrop = 60,
						height = 0.6,
						width = 0.6,
						zindex = 50,
						border = "single",
					},
				},
			},
			util = { enabled = true },
			win = { enabled = true },
		})

		local M = require("utils.keymaps")
		-- Notifier
		M.n("<leader>un", function()
			Snacks.notifier.hide()
		end)
		-- Bufdelete
		M.n("<leader>w", function()
			Snacks.bufdelete({ buf = vim.api.nvim_get_current_buf() })
		end)
		-- Terminal
		M.n("<leader>t", function()
			Snacks.terminal.toggle()
		end, { desc = "Open floating terminal" })
		-- Misc
		M.n("<leader>ln", function()
			Snacks.toggle.option("relativenumber"):toggle()
		end)
	end,
}
