return {
	{
		"folke/snacks.nvim",
		priority = 1000,
		lazy = false,
		opts = {
			bigfile = { enabled = true },
			bufdelete = { enabled = true },
			dashboard = { enabled = true },
			input = { enabled = true },
			layout = { enabled = true },
			notify = { enabled = true },
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
			renamer = { enabled = true },
			scope = { enabled = true },
			statuscolumn = { enabled = true },
			util = { enabled = true },
			win = { enabled = true },
		},
		keys = {
			-- Bufdelete
			{
				"<leader>w",
				function()
					Snacks.bufdelete()
				end,
			},
			{
				"<D-w>",
				function()
					Snacks.bufdelete()
				end,
			},
			-- Picker
			{
				"<leader>f",
				function()
					Snacks.picker.files()
				end,
			},
			{
				"<leader>o",
				function()
					Snacks.picker.recent({
						filter = { cwd = true },
					})
				end,
			},
			{
				"<leader>df",
				function()
					Snacks.picker.files({ cwd = "~/code/dotfiles" })
				end,
			},
			{
				"<leader>r",
				function()
					Snacks.picker.grep()
				end,
			},
			{
				"<leader>gr",
				function()
					Snacks.picker.lsp_references()
				end,
			},
			{
				"gd",
				function()
					Snacks.picker.lsp_definitions()
				end,
			},
			{
				"gt",
				function()
					Snacks.picker.lsp_type_definitions()
				end,
			},
			{
				"gi",
				function()
					Snacks.picker.lsp_implementations()
				end,
			},
			{
				"<leader>O",
				function()
					Snacks.picker.lsp_symbols()
				end,
			},
		},
	},
}
