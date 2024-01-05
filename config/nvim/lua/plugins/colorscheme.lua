return {
	{
		"rose-pine/neovim",
		branch = "canary",
		config = function()
			require("rose-pine").setup({
				variant = "main",
				dark_variant = "main",
				dim_inactive_windows = false,
				extend_background_behind_borders = false,
				styles = {
					bold = true,
					italic = false,
					transparency = false,
				},
				highlight_groups = {
					Comment = { fg = "muted", italic = false },
					Constant = { fg = "gold", italic = false },
					Keyword = { fg = "pine", italic = false },
					ColorColumn = { bg = "rose" },
					Pmenu = { fg = "highlight_high", bg = "base" },
					PmenuSel = { fg = "text", bg = "none" },
					FloatBorder = { fg = "highlight_high" },
					CursorLine = { bg = "highlight_low" },
					StatusLine = { fg = "subtle", bg = "none" },
					-- Telescope
					TelescopeBorder = { fg = "highlight_high", bg = "none" },
					TelescopeNormal = { bg = "none" },
					TelescopePromptNormal = { bg = "none" },
					TelescopePromptPrefix = { fg = "foam" },
					TelescopeResultsNormal = { fg = "subtle", bg = "none" },
					TelescopeSelection = { fg = "text", bg = "none" },
					TelescopeSelectionCaret = { fg = "rose", bg = "rose" },
					-- nvim-cmp
					CmpItemAbbrMatchFuzzy = { fg = "foam", bold = true },
					CmpItemAbbrMatch = { fg = "rose", bold = true },
					CmpItemAbbrDeprecated = { fg = "subtle", strikethrough = true },
					CmpItemKindInterface = { fg = "rose" },
					CmpItemKindVariable = { fg = "rose" },
					CmpItemKindText = { fg = "rose" },
					CmpItemKindFunction = { fg = "love" },
					CmpItemKindMethod = { fg = "love" },
					CmpItemKindProperty = { fg = "text" },
					CmpItemKindUnit = { fg = "text" },
					CmpItemKindKeyword = { fg = "text" },
					CmpItemKindCopilot = { fg = "gold" },
					-- Fidget
					FidgetTitle = { fg = "subtle" },
					FidgetTask = { fg = "subtle" },
				},
			})

			vim.cmd.colorscheme("rose-pine")
		end,
	},
}
