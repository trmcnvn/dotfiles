return {
	pack = { src = "https://github.com/christoomey/vim-tmux-navigator" },
	config = function()
		vim.g.tmux_navigator_no_mappings = 1

		local M = require("utils.keymaps")
		M.n("<C-M-Left>", "<cmd>TmuxNavigateLeft<cr>", { silent = true, desc = "Navigate left (vim/tmux)" })
		M.n("<C-M-Down>", "<cmd>TmuxNavigateDown<cr>", { silent = true, desc = "Navigate down (vim/tmux)" })
		M.n("<C-M-Up>", "<cmd>TmuxNavigateUp<cr>", { silent = true, desc = "Navigate up (vim/tmux)" })
		M.n("<C-M-Right>", "<cmd>TmuxNavigateRight<cr>", { silent = true, desc = "Navigate right (vim/tmux)" })
	end,
}
