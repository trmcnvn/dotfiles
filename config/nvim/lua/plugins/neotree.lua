return {
	{
		"nvim-neo-tree/neo-tree.nvim",
		branch = "v3.x",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-tree/nvim-web-devicons",
			"MunifTanjim/nui.nvim",
		},
		config = function()
			require("neo-tree").setup({
				close_if_last_window = true,
				default_component_configs = {
					indent_size = 2,
					padding = 1,
					with_markers = false,
				},
				window = {
					position = "float",
					width = 30,
					mappings = {
						["z"] = "",
					},
				},
				filesystem = {
					follow_current_file = {
						enabled = true,
					},
					filtered_items = {
						hide_dotfiles = false,
						hide_gitignored = false,
						hide_hidden = false,
					},
					hijack_netrw_behavior = "open_default",
					use_libuv_file_watcher = true,
				},
				buffers = {
					follow_current_file = {
						enabled = true,
					},
				},
			})

			local M = require("utils.keymaps")
			M.n("<leader>b", "<cmd>Neotree float reveal<cr>")
			M.n("<leader>e", "<cmd>Neotree float reveal<cr>")
		end,
	},
}
