return {
	pack = { src = "https://github.com/j-hui/fidget.nvim" },
	config = function()
		require("fidget").setup({
			progress = {
				display = {
					progress_icon = { "dots_negative" },
				},
			},
		})
	end,
}
