return {
	{
		"ThePrimeagen/harpoon",
		lazy = true,
		branch = "harpoon2",
		opts = {
			settings = {
				save_on_toggle = true,
			},
		},
		keys = function()
			local keys = {
				{
					"<leader>\\",
					function()
						require("harpoon"):list():add()
					end,
				},
				{
					"<leader>h",
					function()
						local harpoon = require("harpoon")
						harpoon.ui:toggle_quick_menu(harpoon:list())
					end,
				},
				{
					"<leader>[",
					function()
						require("harpoon"):list():prev()
					end,
				},
				{
					"<leader>]",
					function()
						require("harpoon"):list():next()
					end,
				},
			}
			return keys
		end,
	},
}
