return {
	{
		"echasnovski/mini.diff",
		event = "BufNewFile",
		keys = {
			{
				"<leader>go",
				function()
					require("mini.diff").toggle_overlay(0)
				end,
			},
		},
	},
}
