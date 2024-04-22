return {
	{
		"echasnovski/mini.bufremove",
		keys = {
			{ "<leader>w", "<Cmd>lua MiniBufremove.delete(vim.api.nvim_win_get_buf(0))<CR>", desc = "Close tab" },
			{ "<D-w>", "<Cmd>lua MiniBufremove.delete(vim.api.nvim_win_get_buf(0))<CR>", desc = "Close tab" },
		},
		config = function()
			require("mini.bufremove").setup({})
		end,
	},
}
