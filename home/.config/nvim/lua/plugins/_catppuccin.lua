return {
	pack = { src = "https://github.com/catppuccin/nvim" },
	config = function()
		-- asdasd function
		require("catppuccin").setup({
			term_colors = true,
			color_overrides = {
				mocha = {
					base = "#181825",
				},
			},
			styles = {
				comments = { "italic" },
				conditionals = {},
			},
			integrations = {
				fidget = true,
				mason = true,
				dadbod_ui = true,
			},
		})
		vim.cmd.colorscheme("catppuccin-mocha")
	end,
}
