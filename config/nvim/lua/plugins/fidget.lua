return {
	{
		"j-hui/fidget.nvim",
		tag = false,
		event = "LspAttach",
		config = function()
			require("fidget").setup({
				notification = { window = { winblend = 0 } },
				progress = {
					display = {
						progress_icon = { "dots_negative" },
					},
				},
			})
		end,
	},
}
