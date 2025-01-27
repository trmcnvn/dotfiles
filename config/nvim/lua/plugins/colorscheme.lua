return {
	{
		"rose-pine/neovim",
		config = function()
			require("rose-pine").setup({
				variant = "main",
				dark_variant = "main",
				enable = {
					legacy_highlights = false,
				},
				styles = {
					transparency = true,
				},
				highlight_groups = {
					Comment = { fg = "muted", italic = true },
					Constant = { fg = "gold", italic = false },
					Keyword = { fg = "pine", italic = false },
					ColorColumn = { bg = "rose" },
					Pmenu = { fg = "highlight_high", bg = "base" },
					PmenuSel = { fg = "text", bg = "none" },
					NormalFloat = { bg = "base" },
					FloatBorder = { fg = "highlight_high" },
					FloatTitle = { bg = "base" },
					CursorLine = { bg = "highlight_low" },
					MatchParen = { bold = true, underline = true },
					-- Search
					CurSearch = { fg = "base", bg = "leaf", inherit = false },
					Search = { fg = "text", bg = "leaf", blend = 20, inherit = false },
					-- Telescope (Transparent)
					TelescopeBorder = { fg = "highlight_high", bg = "none" },
					TelescopeNormal = { bg = "none" },
					TelescopePromptNormal = { bg = "base" },
					TelescopeResultsNormal = { fg = "subtle", bg = "none" },
					TelescopeSelection = { fg = "text", bg = "base" },
					TelescopeSelectionCaret = { fg = "rose", bg = "rose" },
					-- blink.cmp
					BlinkCmpLabel = { fg = "rose", bold = true },
					BlinkCmpLabelMatch = { fg = "foam", bold = true },
					BlinkCmpLabelDeprecated = { fg = "subtle", strikethrough = true },
					BlinkCmpKindInterface = { fg = "rose" },
					BlinkCmpKindVariable = { fg = "rose" },
					BlinkCmpKindText = { fg = "rose" },
					BlinkCmpKindFunction = { fg = "love" },
					BlinkCmpKindMethod = { fg = "love" },
					BlinkCmpKindProperty = { fg = "text" },
					BlinkCmpKindUnit = { fg = "text" },
					BlinkCmpKindKeyword = { fg = "text" },
					BlinkCmpKindCopilot = { fg = "gold" },
					-- Fidget
					FidgetTitle = { fg = "subtle" },
					FidgetTask = { fg = "subtle" },
				},
			})
		end,
	},
	{
		"f-person/auto-dark-mode.nvim",
		priority = 1000,
		config = function()
			require("auto-dark-mode").setup({
				set_dark_mode = function()
					vim.opt.background = "dark"
					vim.cmd.colorscheme("rose-pine-main")
				end,
				set_light_mode = function()
					vim.opt.background = "light"
					vim.cmd.colorscheme("rose-pine-dawn")
				end,
			})
		end,
	},
}
