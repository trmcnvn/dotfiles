return {
	{
		"j-hui/fidget.nvim",
		tag = false,
		event = { "BufEnter" },
		config = function()
			require("fidget").setup({
				notification = { window = { winblend = 0 } },
			})
		end,
	},
}
