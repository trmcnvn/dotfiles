return {
	{
		"hrsh7th/nvim-cmp",
		event = "InsertEnter",
		dependencies = {
			"hrsh7th/cmp-buffer",
			"hrsh7th/cmp-nvim-lsp",
			"hrsh7th/cmp-path",
			"hrsh7th/cmp-nvim-lsp-signature-help",
			"saadparwaiz1/cmp_luasnip",
			"onsails/lspkind.nvim",
			{
				"L3MON4D3/LuaSnip",
				build = (function()
					if vim.fn.has("win32") or vim.fn.executable("make") == 0 then
						return
					end
					return "make install_jsregexp"
				end)(),
				dependencies = {
					{
						"rafamadriz/friendly-snippets",
						config = function()
							require("luasnip.loaders.from_vscode").lazy_load()
						end,
					},
				},
			},
		},
		config = function()
			local cmp = require("cmp")
			local luasnip = require("luasnip")
			local format_item_with_lspkind = require("lspkind").cmp_format({
				mode = "symbol_text",
				maxwidth = 50,
				ellipsis_char = "...",
				menu = {
					nvim_lsp = "[LSP]",
					buffer = "[Buffer]",
					path = "[Path]",
					luasnip = "[Snippet]",
					nvim_lsp_signature_help = "[Signature]",
				},
			})

			luasnip.config.setup({})

			cmp.setup({
				preselect = cmp.PreselectMode.None,
				snippet = {
					expand = function(args)
						luasnip.lsp_expand(args.body)
					end,
				},
				window = {
					completion = cmp.config.window.bordered(),
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
					["<CR>"] = cmp.mapping.confirm({ select = false }),
				},
				sources = cmp.config.sources({
					{ name = "nvim_lsp", group_index = 1 },
					{ name = "buffer", max_item_count = 5, group_index = 2 },
					{ name = "path", max_item_count = 3, group_index = 3 },
					{ name = "luasnip", max_item_count = 3, group_index = 5 },
					{ name = "nvim_lsp_signature_help" },
				}),
				formatting = {
					expandable_indicator = true,
					format = function(entry, item)
						-- local color_item = require("nvim-highlight-colors").format(entry, { kind = item.kind })
						item = format_item_with_lspkind(entry, item)
						-- if color_item.abbr_hl_group then
						-- 	item.kind_hl_group = color_item.abbr_hl_group
						-- 	item.kind = color_item.kind
						-- end
						return item
					end,
				},
				experimental = { ghost_text = false },
			})
		end,
	},
}
