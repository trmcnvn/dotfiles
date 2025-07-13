return {
	pack = { src = "https://github.com/Wansmer/treesj" },
	config = function()
		require("treesj").setup({ use_default_keymaps = false, max_join_length = 150 })
		local M = require("utils.keymaps")
		M.n("J", "<cmd>TSJToggle<cr>")
	end,
}
