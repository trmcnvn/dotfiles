return {
	pack = { src = "https://github.com/ThePrimeagen/harpoon", version = "harpoon2" },
	config = function()
		require("harpoon").setup({
			settings = {
				save_on_toggle = true,
			},
		})

		local M = require("utils.keymaps")
		M.n("<leader>\\", function()
			require("harpoon"):list():add()
		end)
		M.n("<leader>h", function()
			local harpoon = require("harpoon")
			harpoon.ui:toggle_quick_menu(harpoon:list())
		end)
		M.n("<leader>[", function()
			require("harpoon"):list():prev()
		end)
		M.n("<leader>]", function()
			require("harpoon"):list():next()
		end)
	end,
}
