return {
	{
		"saghen/blink.cmp",
		lazy = false,
		dependencies = {
			"rafamadriz/friendly-snippets",
		},
		version = "*",
		build = "cargo build --release",
		opts = {
			keymap = { preset = "super-tab" },
			signature = {
				enabled = true,
				window = { show_documentation = false },
			},
			completion = {
				trigger = { show_in_snippet = false },
				menu = {
					auto_show = function(ctx)
						return ctx.mode ~= "cmdline" or not vim.tbl_contains({ "/", "?" }, vim.fn.getcmdtype())
					end,
					draw = {
						components = {
							kind_icon = {
								ellipsis = false,
								text = function(ctx)
									local kind_icon, _, _ = MiniIcons.get("lsp", ctx.kind)
									return kind_icon
								end,
								highlight = function(ctx)
									local _, hl, _ = MiniIcons.get("lsp", ctx.kind)
									return hl
								end,
							},
						},
					},
				},
			},
		},
	},
}
