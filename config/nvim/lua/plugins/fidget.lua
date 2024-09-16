return {
	{
		"j-hui/fidget.nvim",
		tag = "legacy",
		event = { "BufEnter" },
		config = function()
			require("fidget").setup({
				text = {
					spinner = "dots_negative",
				},
				align = { bottom = true },
				window = { relative = "editor", blend = 0 },
				notification = { window = { winblend = 0 } },
			})
		end,
	},
}
