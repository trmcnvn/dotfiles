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
		})
		vim.cmd.colorscheme("catppuccin-mocha")
	end,
}
