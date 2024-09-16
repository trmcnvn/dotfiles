return {
	{
		"stevearc/oil.nvim",
		opts = {},
		config = function()
			require("oil").setup({
				default_file_explorer = true,
				delete_to_trash = true,
				keymaps = {
					["<CR>"] = "actions.select",
					["q"] = "actions.close",
					["<esc>"] = "actions.close",
					["-"] = "actions.parent",
					["_"] = "actions.open_cwd",
					["g?"] = "actions.show_help",
					["g."] = "actions.toggle_hidden",
				},
				use_default_keymaps = false,
				float = {
					max_width = 42,
					override = function(conf)
						return vim.tbl_extend("force", conf, { row = 2, col = 2 })
					end,
				},
			})

			local M = require("utils.keymaps")
			M.n("<leader>e", function()
				require("oil").toggle_float()
			end)
		end,
	},
}
