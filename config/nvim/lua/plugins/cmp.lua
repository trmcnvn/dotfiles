return {
	{
		"saghen/blink.cmp",
		lazy = false,
		event = "InsertEnter",
		dependencies = {
			"rafamadriz/friendly-snippets",
			"saghen/blink.compat",
		},
		version = "*",
		build = "cargo build --release",
		config = function()
			require("blink.cmp").setup({
				keymap = { preset = "super-tab" },
				appearance = {
					use_nvim_cmp_as_default = true,
					nerd_font_variant = "mono",
				},
				signature = {
					enabled = false,
					window = {
						border = "single",
					},
				},
				sources = {
					default = {
						"lazydev",
						"lsp",
						"path",
						"snippets",
						"buffer",
					},
					providers = {
						lazydev = {
							name = "LazyDev",
							module = "lazydev.integrations.blink",
							score_offset = 100,
						},
					},
				},
				cmdline = { enabled = false },
				term = { enabled = false },
				completion = {
					ghost_text = { enabled = false },
					documentation = {
						auto_show = true,
						auto_show_delay_ms = 50,
						window = {
							border = "single",
						},
					},
					trigger = { show_in_snippet = false },
					list = {
						selection = {
							preselect = false,
						},
					},
					menu = {
						border = "single",
						draw = {
							treesitter = { "lsp" },
							components = {
								kind_icon = {
									ellipsis = false,
									text = function(ctx)
										local kind_icon, _, _ = Snacks.util.icon(ctx.kind, "lsp")
										return kind_icon .. ctx.icon_gap
									end,
									highlight = function(ctx)
										local _, hl, _ = Snacks.util.icon(ctx.kind, "lsp")
										return hl or ("BlinkCmpKind" .. ctx.kind)
									end,
								},
							},
						},
					},
				},
			})
		end,
	},
}
