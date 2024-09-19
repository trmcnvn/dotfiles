return {
	{
		"echasnovski/mini.bufremove",
		keys = {
			{ "<leader>w", "<Cmd>lua MiniBufremove.delete(vim.api.nvim_win_get_buf(0))<CR>", desc = "Close buffer" },
			{ "<D-w>", "<Cmd>lua MiniBufremove.delete(vim.api.nvim_win_get_buf(0))<CR>", desc = "Close buffer" },
		},
		config = function()
			require("mini.bufremove").setup({})
		end,
	},
}
