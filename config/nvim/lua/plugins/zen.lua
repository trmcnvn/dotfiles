return {
	{
		"folke/zen-mode.nvim",
		config = function()
			require("zen-mode").setup({
				on_open = function(win)
					local buffline = package.loaded["bufferline"]
					if buffline then
						local view = require("zen-mode.view")
						local layout = view.layout(view.opts)
						vim.api.nvim_win_set_config(win, {
							width = layout.width,
							height = layout.height - 1,
						})
						vim.api.nvim_win_set_config(view.bg_win, {
							width = vim.o.columns,
							height = view.height() - 1,
							row = 1,
							col = layout.col,
							relative = "editor",
						})
					end
				end,
			})
		end,
	},
}
