return {
	{
		"nvim-telescope/telescope.nvim",
		dependencies = {
			{ "nvim-lua/plenary.nvim", lazy = true },
			"natecraddock/telescope-zf-native.nvim",
			"nvim-telescope/telescope-ui-select.nvim",
		},
		config = function()
			local actions = require("telescope.actions")
			local builtin = require("telescope.builtin")
			require("telescope").setup({
				defaults = {
					vimgrep_arguments = {
						"rg",
						"--color=never",
						"--no-heading",
						"--with-filename",
						"--line-number",
						"--column",
						"--smart-case",
					},
					prompt_prefix = "> ",
					selection_caret = "> ",
					initial_mode = "insert",
					file_ignore_patterns = {
						".git",
						"node_modules",
						"sorbet",
						"%.svg",
						"build",
						".svelte-kit",
						".turbo",
						".ruby-lsp",
						"Gemfile.lock",
						"pnpm-lock.yaml",
					},
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
					layout_config = {
						horizontal = { preview_width = 80 },
						prompt_position = "top",
					},
					layout_strategy = "horizontal",
					sorting_strategy = "ascending",
					winblend = 0,
				},
				pickers = {
					find_files = {
						theme = "dropdown",
						previewer = false,
						find_command = { "rg", "--files", "--glob", "!**/.git/*", "-L" },
					},
					live_grep = { theme = "dropdown", previewer = false },
					buffers = { theme = "dropdown", previewer = false },
					oldfiles = { theme = "dropdown", previewer = false },
				},
				extensions = {
					["zf-native"] = {},
					["ui-select"] = {
						require("telescope.themes").get_dropdown({}),
					},
				},
			})

			pcall(require("telescope").load_extension, "zf-native")
			pcall(require("telescope").load_extension, "ui-select")

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
