return {
	{
		"saghen/blink.cmp",
		lazy = false,
		dependencies = {
			"rafamadriz/friendly-snippets",
		},
		version = "*",
		build = "cargo build --release",
		config = function()
			require("blink.cmp").setup({
				keymap = { preset = "super-tab" },
				completion = {
					ghost_text = {
						show_with_selection = false,
					},
					trigger = {
						show_in_snippet = false,
					},
					menu = {
						border = "rounded",
						scrollbar = false,
						winhighlight = "Normal:BlinkCmpMenu,CursorLine:BlinkCmpSelection,Search:PmenuSel",
						auto_show = function(ctx)
							return ctx.mode ~= "cmdline" or not vim.tbl_contains({ "/", "?" }, vim.fn.getcmdtype())
						end,
						draw = {
							treesitter = { "lsp" },
							components = {
								kind_icon = {
									ellipsis = false,
									text = function(ctx)
										local kind_icon, _, _ = MiniIcons.get("lsp", ctx.kind)
										return kind_icon
									end,
									highlight = function(ctx)
										local _, hl, _ = MiniIcons.get("lsp", ctx.kind)
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
