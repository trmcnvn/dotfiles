return {
	pack = { src = "https://github.com/j-hui/fidget.nvim" },
	config = function()
		require("fidget").setup({
			notification = {
				window = {
					winblend = 0,
				},
			},
			progress = {
				display = {
					progress_icon = { "dots_negative" },
				},
			},
		})
	end,
}
