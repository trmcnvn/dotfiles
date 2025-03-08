return {
	{
		"saghen/blink.cmp",
		lazy = false,
		dependencies = {
			"rafamadriz/friendly-snippets",
			"saghen/blink.compat",
		},
		version = "*",
		build = "cargo build --release",
		config = function()
			require("blink.cmp").setup({
				keymap = { preset = "super-tab" },
				sources = {
					default = {
						"lsp",
						"path",
						"snippets",
						"buffer",
						"avante_commands",
						"avante_mentions",
						"avante_files",
					},
					providers = {
						avante_commands = {
							name = "avante_commands",
							module = "blink.compat.source",
							score_offset = 90,
							opts = {},
						},
						avante_files = {
							name = "avante_files",
							module = "blink.compat.source",
							score_offset = 100,
							opts = {},
						},
						avante_mentions = {
							name = "avante_mentions",
							module = "blink.compat.source",
							score_offset = 1000,
							opts = {},
						},
					},
				},
				cmdline = { enabled = false },
				completion = {
					documentation = {
						auto_show = true,
						auto_show_delay_ms = 200,
						window = {
							border = "rounded",
							scrollbar = false,
						},
					},
					ghost_text = {
						show_with_selection = false,
					},
					trigger = {
						show_in_snippet = false,
					},
					menu = {
						border = "rounded",
						scrollbar = false,
						auto_show = function(ctx)
							return ctx.mode ~= "cmdline" or not vim.tbl_contains({ "/", "?" }, vim.fn.getcmdtype())
						end,
						draw = {
							treesitter = { "lsp" },
							components = {
								kind_icon = {
									ellipsis = false,
									text = function(ctx)
										local kind_icon, _, _ = Snacks.util.icon(ctx.kind, "lsp")
										return kind_icon
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

			-- Copilot
			vim.api.nvim_create_autocmd("User", {
				pattern = "BlinkCmpMenuOpen",
				callback = function()
					require("copilot.suggestion").dismiss()
					vim.b.copilot_suggestion_hidden = true
				end,
			})

			vim.api.nvim_create_autocmd("User", {
				pattern = "BlinkCmpMenuClose",
				callback = function()
					vim.b.copilot_suggestion_hidden = false
				end,
			})
		end,
	},
}
