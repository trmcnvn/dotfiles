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
					transparency = false,
					italic = false,
				},
				highlight_groups = {},
			})
		end,
	},
	{
		"catppuccin/nvim",
		name = "catppuccin",
		config = function()
			require("catppuccin").setup({
				flavour = "mocha",
				term_colors = true,
				integrations = {
					cmp = true,
					fidget = true,
					harpoon = true,
					mason = true,
					dap = true,
					dap_ui = true,
					treesitter = true,
					ufo = true,
					render_markdown = true,
					snacks = {
						enabled = true,
						indent_scope_color = "text",
					},
				},
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
