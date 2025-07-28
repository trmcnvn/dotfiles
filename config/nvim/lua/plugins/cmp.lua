return {
	pack = { src = "https://github.com/hrsh7th/nvim-cmp" },
	config = function()
		local cmp = require("cmp")
		local format_item_with_lspkind = require("lspkind").cmp_format({
			mode = "symbol_text",
			maxwidth = 60,
			ellipsis_char = "…",
		})
		cmp.setup({
			preselect = cmp.PreselectMode.None,
			snippet = {
				expand = function(args)
					require("luasnip").lsp_expand(args.body)
				end,
			},
			window = {
				completion = cmp.config.window.bordered({ scrollbar = false }),
				documentation = cmp.config.window.bordered(),
			},
			completion = { completeopt = "menu,menuone,noinsert,noselect" },
			mapping = {
				["<Tab>"] = cmp.mapping.select_next_item(),
				["<S-Tab>"] = cmp.mapping.select_prev_item(),
				["<C-u>"] = cmp.mapping.scroll_docs(-4),
				["<C-d>"] = cmp.mapping.scroll_docs(4),
				["<C-e>"] = cmp.mapping.close(),
				["<C-Space>"] = cmp.mapping.complete(),
				["<CR>"] = cmp.mapping.confirm({
					bahavior = cmp.ConfirmBehavior.Insert,
					select = true,
				}),
			},
			sources = cmp.config.sources({
				{ name = "nvim_lsp" },
				{ name = "luasnip" },
				{ name = "buffer" },
				{ name = "nvim_lua" },
				{ name = "async_path" },
			}),
			formatting = {
				expandable_indicator = true,
				format = function(entry, item)
					item = format_item_with_lspkind(entry, item)
					return item
				end,
				fields = { "abbr", "kind", "menu" },
			},
			experimental = { ghost_text = false },
		})
	end,
}
