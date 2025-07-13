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
			picker = {
				win = {
					input = {
						keys = {
							["<Escape>"] = { "close", mode = { "n", "i" } },
						},
					},
				},
				formatters = {
					file = {
						truncate = 80,
					},
				},
				layout = {
					preview = false,
					layout = {
						backdrop = false,
						width = 0.4,
						min_width = 80,
						height = 0.4,
						min_height = 15,
						border = "none",
						box = "vertical",
						{
							box = "vertical",
							border = "single",
							title = "{title} {live} {flags}",
							title_pos = "center",
							{ win = "input", height = 1, border = "bottom" },
							{ win = "list", border = "none" },
						},
					},
				},
			},
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
		M.n("<leader>n", function()
			Snacks.picker.notifications()
		end)
		M.n("<leader>un", function()
			Snacks.notifier.hide()
		end)
		-- Bufdelete
		M.n("<leader>w", function()
			Snacks.bufdelete({ buf = vim.api.nvim_get_current_buf() })
		end)
		M.n("<D-w>", function()
			Snacks.bufdelete({ buf = vim.api.nvim_get_current_buf() })
		end)
		-- Picker
		M.n("<leader>f", function()
			Snacks.picker.files()
		end)
		M.n("<leader>o", function()
			Snacks.picker.recent({
				filter = { cwd = true },
			})
		end)
		M.n("<leader>df", function()
			Snacks.picker.files({ cwd = "~/code/dotfiles" })
		end)
		M.n("<leader>r", function()
			Snacks.picker.grep()
		end)
		M.n("<leader>gr", function()
			Snacks.picker.lsp_references()
		end)
		M.n("gd", function()
			Snacks.picker.lsp_definitions()
		end)
		M.n("gt", function()
			Snacks.picker.lsp_type_definitions()
		end)
		M.n("gi", function()
			Snacks.picker.lsp_implementations()
		end)
		M.n("<leader>O", function()
			Snacks.picker.lsp_symbols()
		end)
		-- Misc
		M.n("<leader>ln", function()
			Snacks.toggle.option("relativenumber"):toggle()
		end)
	end,
}
