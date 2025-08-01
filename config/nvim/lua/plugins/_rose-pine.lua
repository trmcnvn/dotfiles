return {
	pack = { src = "https://github.com/rose-pine/neovim" },
	config = function()
		-- local palette = require("rose-pine.palette")
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
		})
		vim.cmd.colorscheme("rose-pine")
	end,
}
