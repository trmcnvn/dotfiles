return {
	"MunifTanjim/nui.nvim",
	{
		"nvim-neo-tree/neo-tree.nvim",
		opts = {
			close_if_last_window = false,
			default_component_configs = {
				indent_size = 2,
				padding = 1,
				with_markers = false,
			},
			window = {
				width = 30,
				mappings = {
					["z"] = ""
				},
			},
			filesystem = {
				follow_current_file = true,
				filtered_items = {
					hide_dotfiles = false,
					hide_gitignored = false,
					hide_hidden = false,
				}
			},
			buffers = {
				follow_current_file = true,
			}
		},
		keys = {
			{ "<leader>b", "<cmd>Neotree toggle show<cr>", desc = "Neotree" }
		}
	}
}
