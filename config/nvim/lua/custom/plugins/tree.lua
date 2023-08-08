return {
	"MunifTanjim/nui.nvim",
	{
		"nvim-neo-tree/neo-tree.nvim",
		branch = "v3.x",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-tree/nvim-web-devicons",
			"MunifTanjim/nui.nvim",
		},
		opts = {
			close_if_last_window = true,
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
				follow_current_file = {
					enabled = true
				},
				filtered_items = {
					hide_dotfiles = false,
					hide_gitignored = false,
					hide_hidden = false,
				}
			},
			buffers = {
				follow_current_file = {
					enabled = true
				},
			}
		},
		keys = {
			{ "<leader>b", "<cmd>Neotree toggle focus<cr>", desc = "Neotree" }
		}
	}
}
