return {
	{
		"stevearc/oil.nvim",
		opts = {},
		dependencies = { "nvim-tree/nvim-web-devicons" },
		config = function()
			require("oil").setup({
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
			})

			local M = require("utils.keymaps")
			M.n("<leader>e", function()
				require("oil").toggle_float()
			end)
		end,
	},
}
