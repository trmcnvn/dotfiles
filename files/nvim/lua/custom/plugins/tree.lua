return {
	"MunifTanjim/nui.nvim",
	{
		"nvim-neo-tree/neo-tree.nvim",
		opts = {
			close_if_last_window = true
		},
		keys = {
			{ "<leader>b", "<cmd>Neotree toggle<cr>", desc = "Neotree" }
		}
	}
}
