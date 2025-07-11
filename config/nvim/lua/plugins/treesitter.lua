return {
	{
		"nvim-treesitter/nvim-treesitter",
		branch = "main",
		lazy = false,
		build = function()
			local ensure_installed = {
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
				"markdown",
				"markdown_inline",
				"dockerfile",
				"sql",
			}
			require("nvim-treesitter").install(ensure_installed)
			require("nvim-treesitter").update()
		end,
		init = function()
			vim.api.nvim_create_autocmd("FileType", {
				callback = function(args)
					local filetype = args.match
					local lang = vim.treesitter.language.get_lang(filetype) or ""
					if not vim.tbl_contains(require("nvim-treesitter.config").get_available(), lang) then
						return
					end

					require("nvim-treesitter").install(lang):await(function()
						vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
						vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
						vim.treesitter.start()
					end)
				end,
			})
		end,
	},
}
