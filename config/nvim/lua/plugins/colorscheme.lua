return {
	{
		"rose-pine/neovim",
		config = function()
			require("rose-pine").setup({
				variant = "main",
				dark_variant = "main",
				enable = {
					legacy_highlights = false,
					migrations = false,
				},
				styles = {
					transparency = true,
					italic = false,
				},
				highlight_groups = {},
			})
		end,
	},
	{
		"f-person/auto-dark-mode.nvim",
		config = function()
			require("auto-dark-mode").setup({
				set_dark_mode = function()
					vim.api.nvim_set_option_value("background", "dark", {})
					vim.cmd.colorscheme("rose-pine-main")
				end,
				set_light_mode = function()
					vim.api.nvim_set_option_value("background", "light", {})
					vim.cmd.colorscheme("rose-pine-dawn")
				end,
			})
		end,
	},
}
