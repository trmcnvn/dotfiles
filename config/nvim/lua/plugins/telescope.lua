return {
	{
		"nvim-telescope/telescope.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			{
				"nvim-telescope/telescope-fzf-native.nvim",
				build = "cmake -S. -Bbuild -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release && cmake --install build --prefix build",
				cond = vim.fn.executable("cmake") == 1,
			},
			"natecraddock/telescope-zf-native.nvim",
		},
		config = function()
			local actions = require("telescope.actions")
			local builtin = require("telescope.builtin")
			require("telescope").setup({
				defaults = {
					prompt_prefix = "> ",
					selection_caret = "> ",
					initial_mode = "insert",
					file_ignore_patterns = { ".git/", "node_modules", "sorbet" },
					mappings = {
						i = {
							["<Down>"] = actions.move_selection_next,
							["<Up>"] = actions.move_selection_previous,
							["<C-j>"] = actions.move_selection_next,
							["<C-k>"] = actions.move_selection_previous,
							["<Escape>"] = actions.close,
						},
						n = {
							["q"] = actions.close,
						},
					},
					hidden = true,
					layout_strategy = "horizontal",
					sorting_strategy = "ascending",
				},

				pickers = {
					find_files = { theme = "dropdown", previewer = false },
					live_grep = { theme = "dropdown", previewer = false },
					buffers = { theme = "dropdown", previewer = false },
					oldfiles = { theme = "dropdown", previewer = false },
				},
				extensions = {
					["zf-native"] = {
						file = {
							enable = true,
							highlight_results = true,
							match_filename = true,
						},
						generic = {
							enable = true,
							highlight_results = true,
							match_filename = true,
						},
					},
				},
			})

			pcall(require("telescope").load_extension, "fzf")
			pcall(require("telescope").load_extension, "zf-native")
			pcall(require("telescope").load_extension, "harpoon")

			local M = require("utils.keymaps")
			M.n("<leader>f", function()
				builtin.find_files()
			end)
			M.n("<leader>df", function()
				builtin.find_files({ cwd = "~/code/dotfiles" })
			end)
			M.n("<leader>o", function()
				builtin.oldfiles()
			end)
			M.n("<leader>r", function()
				builtin.live_grep({ previewer = false })
			end)
			-- LSP
			M.n("<leader>gr", function()
				builtin.lsp_references()
			end)
			M.n("gd", function()
				builtin.lsp_definitions()
			end)
			M.n("gt", function()
				builtin.lsp_type_definitions()
			end)
			M.n("gi", function()
				builtin.lsp_implementations()
			end)
		end,
	},
}
