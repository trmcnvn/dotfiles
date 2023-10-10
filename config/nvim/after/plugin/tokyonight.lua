require("tokyonight").setup({
	style = "night",
	transparent = false,
	terminal_colors = true,
	styles = {
		comments = { italic = false },
		keywords = { italic = false }
	},
	hide_inactive_statusline = true,
	dim_inactive = true,
	lualine_bold = true
})

-- vim.cmd [[colorscheme tokyonight]]
