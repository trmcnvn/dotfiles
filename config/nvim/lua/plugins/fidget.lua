return {
	{
		"j-hui/fidget.nvim",
		lazy = true,
		tag = false,
		event = { "BufNewFile" },
		config = function()
			require("fidget").setup({
				notification = { window = { winblend = 0 } },
			})
		end,
	},
}
