return {
	{
		"nvim-treesitter/nvim-treesitter",
		build = ":TSUpdate",
		event = { "BufReadPost", "BufNewFile" },
		dependencies = {
			"nvim-treesitter/nvim-treesitter-refactor",
		},
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
					"lua",
					"html",
					"svelte",
					"go",
					"ruby",
					"rust",
					"vim",
					"graphql",
					"zig",
				},
				sync_install = false,
				highlight = {
					enable = true,
					additional_vim_regex_highlighting = false,
					disable = function(_, buf)
						return vim.b[buf].big
					end,
				},
				indent = { enable = true },
				refactor = {
					highlight_definitions = { enable = false },
					highlight_current_scope = { enable = false },
					smart_rename = {
						enable = true,
						disable = function(_, buf)
							return vim.b[buf].big
						end,
						keymaps = { smart_rename = "gn" },
					},
				},
			})
		end,
	},
}
