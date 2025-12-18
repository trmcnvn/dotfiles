return {
	pack = { src = "https://github.com/vague-theme/vague.nvim" },
	config = function()
		require("vague").setup({
			transparent = true,
			bold = false,
			style = {
				strings = "none",
				keyword_return = "none",
			},
		})
		vim.cmd.colorscheme("vague")
	end,
}
