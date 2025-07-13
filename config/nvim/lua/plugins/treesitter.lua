return {
	pack = { src = "https://github.com/nvim-treesitter/nvim-treesitter", version = "main" },
	config = function()
		vim.api.nvim_create_autocmd("PackChanged", {
			callback = function(event)
				if event.data.kind == "delete" then
					return
				end
				require("nvim-treesitter").update()
			end,
		})

		vim.api.nvim_create_autocmd("FileType", {
			callback = function(args)
				local filetype = args.match
				local lang = vim.treesitter.language.get_lang(filetype)
				if not vim.tbl_contains(require("nvim-treesitter.config").get_available(), lang) then
					return
				end

				require("nvim-treesitter").install(lang):await(function()
					vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
					vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
					pcall(vim.treesitter.start)
				end)
			end,
		})
	end,
}
