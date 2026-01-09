return {
	pack = { src = "https://github.com/rose-pine/neovim" },
	config = function()
		require("rose-pine").setup({
			variant = "main",
			styles = {
				italic = false,
			},
			highlight_groups = {
				Comment = { italic = true },
			},
		})
		vim.cmd.colorscheme("rose-pine")
	end,
}
