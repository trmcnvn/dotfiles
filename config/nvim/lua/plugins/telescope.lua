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
						"-L",
						"--color=never",
						"--no-heading",
						"--with-filename",
						"--line-number",
						"--column",
						"--smart-case",
					},
					prompt_prefix = "   ",
					selection_caret = "> ",
					entry_prefix = "  ",
					initial_mode = "insert",
					selection_strategy = "reset",
					layout_strategy = "horizontal",
					sorting_strategy = "ascending",
					winblend = 0,
					path_display = { "truncate" },
					border = {},
					borderchars = { "─", "│", "─", "│", "╭", "╮", "╯", "╰" },
					color_devicons = true,
					set_env = { ["COLORTERM"] = "truecolor" },
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
						horizontal = {
							prompt_position = "top",
							results_width = 0.8,
						},
						vertical = {
							mirror = false,
						},
						width = 0.87,
						height = 0.80,
					},
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
			M.n("<leader><leader>", builtin.buffers)
			M.n("<leader>f", builtin.find_files)
			M.n("<leader>o", builtin.oldfiles)
			M.n("<leader>df", function()
				builtin.find_files({ cwd = "~/code/dotfiles" })
			end)
			M.n("<leader>r", function()
				builtin.live_grep({ previewer = false })
			end)
			-- LSP
			M.n("<leader>gr", builtin.lsp_references)
			M.n("gd", builtin.lsp_definitions)
			M.n("gt", builtin.lsp_type_definitions)
			M.n("gi", builtin.lsp_implementations)
		end,
	},
}
