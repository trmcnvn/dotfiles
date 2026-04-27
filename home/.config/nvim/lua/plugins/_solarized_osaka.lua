return {
	pack = { src = "https://github.com/craftzdog/solarized-osaka.nvim" },
	config = function()
		require("solarized-osaka").setup({
			transparent = false,
			terminal_colors = true,
			styles = {
				comments = { italic = true },
				keywords = { italic = false },
				functions = {},
				variables = {},
				sidebars = "dark",
				floats = "dark",
			},
			sidebars = { "qf", "help", "terminal" },
			hide_inactive_statusline = false,
			dim_inactive = false,
			lualine_bold = false,
		})
		vim.cmd.colorscheme("solarized-osaka")
	end,
}
