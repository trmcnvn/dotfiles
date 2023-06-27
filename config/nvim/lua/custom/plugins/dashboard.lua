return {
	{
		"glepnir/dashboard-nvim",
		event = "VimEnter",
		opts = {
			theme = "hyper",
			shortcut_type = "number",
			config = {
				week_header = { enable = true },
				shortcut = {
					{
						desc = "Open last session",
						group = "@grp",
						key = "l",
						action = "lua require(\"persistence\").load({ last = true })"
					}
				}
			},
			hide = {
				statusline = true,
				tabline = true,
				winbar = true
			}
		}
	}
}
