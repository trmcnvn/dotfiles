return {
	{
		"nvim-treesitter/nvim-treesitter",
		version = false,
		build = ":TSUpdate",
		event = {  "VeryLazy" },
		lazy = vim.fn.argc(-1) == 0,
		dependencies = { "nvim-treesitter/nvim-treesitter-refactor" },
		cmd = { "TSUpdateSync", "TSUpdate", "TSInstall" },
		config = function()
			require("nvim-treesitter.configs").setup({
				ensure_installed = {
					"bash",
					"astro",
					"typescript",
					"toml",
					"fish",
					"json",
					"yaml",
					"css",
					"regex",
					"lua",
					"html",
					"svelte",
					"go",
					"ruby",
					"rust",
					"vim",
					"graphql",
					"zig",
					"just",
				},
				sync_install = false,
				highlight = {
					enable = true,
					use_languagetree = true,
					additional_vim_regex_highlighting = false,
					disable = function(_, buf)
						return vim.b[buf].big
					end, -- Disable for big files
				},
				indent = { enable = true },
				incremental_selection = {
					enable = true,
					keymaps = {
						init_selection = "<C-space>",
						node_incremental = "<C-space>",
						scope_incremental = false,
						node_decremental = "<C-backspace>",
					},
				},
				textobjects = {
					move = {
						enable = true,
						set_jumps = true, -- whether to set jumps in the jumplist
						goto_next_start = {
							["]f"] = "@function.outer",
							["]c"] = "@class.outer",
							["]a"] = "@parameter.inner",
						},
						goto_next_end = {
							["]F"] = "@function.outer",
							["]C"] = "@class.outer",
							["]A"] = "@parameter.inner",
						},
						goto_previous_start = {
							["[f"] = "@function.outer",
							["[c"] = "@class.outer",
							["[a"] = "@parameter.inner",
						},
						goto_previous_end = {
							["[F"] = "@function.outer",
							["[C"] = "@class.outer",
							["[A"] = "@parameter.inner",
						},
					},
				},
				refactor = {
					highlight_definitions = { enable = false },
					highlight_current_scope = { enable = false },
					smart_rename = {
						enable = true,
						disable = function(_, buf)
							return vim.b[buf].big
						end,
						keymaps = { smart_rename = "gn" }, -- Matches LSP rename keymap
					},
				},
			})
		end,
	},
}
