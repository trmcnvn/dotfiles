return {
	pack = { src = "https://github.com/MeanderingProgrammer/render-markdown.nvim" },
	config = function()
		require("render-markdown").setup({
			code = {
				sign = false,
				width = "block",
				right_pad = 1,
			},
			heading = {
				sign = false,
				icons = {},
			},
		})
	end,
}
