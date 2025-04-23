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
					expandable_indiacator = true,
					format = function(entry, item)
						local color_item = require("nvim-highlight-colors").format(entry, { kind = item.kind })
						item = format_item_with_lspkind(entry, item)
						if color_item.abbr_hl_group then
							item.kind_hl_group = color_item.abbr_hl_group
							item.kind = color_item.kind
						end
						return item
					end,
				},
				experimental = { ghost_text = false },
			})
		end,
	},
	-- {
	-- 	"saghen/blink.cmp",
	-- 	event = "InsertEnter",
	-- 	dependencies = {
	-- 		"rafamadriz/friendly-snippets",
	-- 		"saghen/blink.compat",
	-- 		"Kaiser-Yang/blink-cmp-avante",
	-- 	},
	-- 	version = "*",
	-- 	build = "cargo build --release",
	-- 	config = function()
	-- 		require("blink.cmp").setup({
	-- 			keymap = { preset = "super-tab" },
	-- 			appearance = {
	-- 				use_nvim_cmp_as_default = true,
	-- 				nerd_font_variant = "mono",
	-- 			},
	-- 			signature = {
	-- 				enabled = false,
	-- 				window = { border = "single" },
	-- 			},
	-- 			sources = {
	-- 				default = { "avante", "lazydev", "lsp", "path", "snippets", "buffer" },
	-- 				providers = {
	-- 					avante = {
	-- 						module = "blink-cmp-avante",
	-- 						name = "Avante",
	-- 						opts = {},
	-- 					},
	-- 					lazydev = {
	-- 						name = "LazyDev",
	-- 						module = "lazydev.integrations.blink",
	-- 						score_offset = 100, -- Boost LazyDev priority
	-- 					},
	-- 				},
	-- 			},
	-- 			cmdline = { enabled = false },
	-- 			term = { enabled = false },
	-- 			completion = {
	-- 				ghost_text = { enabled = false },
	-- 				documentation = {
	-- 					auto_show = true,
	-- 					auto_show_delay_ms = 50, -- Fast docs popup
	-- 					window = { border = "single" },
	-- 				},
	-- 				trigger = { show_in_snippet = false },
	-- 				list = {
	-- 					selection = { preselect = false },
	-- 				},
	-- 				menu = {
	-- 					border = "single",
	-- 					draw = {
	-- 						treesitter = { "lsp" },
	-- 						components = {
	-- 							kind_icon = {
	-- 								ellipsis = false,
	-- 								text = function(ctx)
	-- 									if Snacks then
	-- 										local icon, _, _ = Snacks.util.icon(ctx.kind, "lsp")
	-- 										return (icon or "?") .. ctx.icon_gap
	-- 									end
	-- 									return "?" .. ctx.icon_gap
	-- 								end,
	-- 								highlight = function(ctx)
	-- 									if Snacks then
	-- 										local _, hl, _ = Snacks.util.icon(ctx.kind, "lsp")
	-- 										return hl or ("BlinkCmpKind" .. ctx.kind)
	-- 									end
	-- 									return "BlinkCmpKind" .. ctx.kind
	-- 								end,
	-- 							},
	-- 						},
	-- 					},
	-- 				},
	-- 			},
	-- 		})
	-- 	end,
	-- },
}
