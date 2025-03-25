return {
	{
		"zbirenbaum/copilot.lua",
		event = { "BufNewFile" },
		config = function()
			require("copilot").setup({
				panel = { enabled = false },
				suggestion = { auto_trigger = true },
				copilot_model = "gpt-4o-copilot",
			})
		end,
	},
}
