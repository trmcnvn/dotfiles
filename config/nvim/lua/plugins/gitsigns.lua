return {
	pack = { src = "https://github.com/nvim-mini/mini.diff" },
	config = function()
		local M = require("utils.keymaps")
		M.n("<leader>go", function()
			require("mini.diff").toggle_overlay(0)
		end)
	end,
}
