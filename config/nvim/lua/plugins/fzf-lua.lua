return {
	pack = { src = "https://github.com/ibhagwan/fzf-lua" },
	config = function()
		local M = require("utils.keymaps")
		M.n("<leader>f", "<cmd>FzfLua files<cr>", { desc = "Find files" })
		M.n("<leader>r", "<cmd>FzfLua live_grep<cr>", { desc = "Live search" })
		M.n("<leader>o", "<cmd>FzfLua old_files<cr>", { desc = "Recent files" })
	end,
}
