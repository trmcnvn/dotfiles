return {
	pack = { src = "https://github.com/catppuccin/nvim" },
	config = function()
		require("catppuccin").setup({
			flavour = "mocha",
			transparent_background = true,
			term_colors = true,
			no_italic = true,
			integrations = {
				fidget = true,
				harpoon = true,
				mason = true,
				snacks = { enabled = true },
				dadbod_ui = true,
			},
			highlight_overrides = {
				mocha = function(mocha)
					return {
						SlimlineModeNormal = { fg = mocha.blue },
						SlimlineModeVisual = { fg = mocha.mauve },
						SlimlineModeInsert = { fg = mocha.green },
						SlimlineModeReplace = { fg = mocha.red },
						SlimlineModeCommand = { fg = mocha.peach },
						SlimlinePathPrimary = { fg = mocha.rosewater },
						SlimlineFiletype_lspPrimary = { fg = mocha.rosewater },
					}
				end,
			},
		})
		-- vim.cmd.colorscheme("catppuccin-mocha")
	end,
}
