return {
	{
		"rose-pine/neovim",
		config = function()
			require("rose-pine").setup({
				variant = "main",
				dark_variant = "main",
				dim_inactive_windows = false,
				extend_background_behind_borders = false,
				enable = {
					legacy_highlights = false,
				},
				styles = {
					bold = false,
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
					MatchParen = { bold = true, underline = true },
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
					CmpItemKindSupermaven = { fg = "gold" },
					-- Fidget
					FidgetTitle = { fg = "subtle" },
					FidgetTask = { fg = "subtle" },
				},
			})
			vim.cmd.colorscheme("rose-pine")
		end,
	},

	{
		"folke/tokyonight.nvim",
		config = function()
			require("tokyonight").setup({
				style = "night",
				transparent = false,
			})
			-- vim.cmd.colorscheme("tokyonight")
		end,
	},

	{
		"Mofiqul/dracula.nvim",
		config = function()
			local colors = {
				bg = "#22212C",
				bg_light = "#2E2B3B",
				bg_lighter = "#393649",
				fg = "#F8F8F2",
				selection = "#454158",
				comment = "#7970A9",
				red = "#FF9580",
				orange = "#FFCA80",
				yellow = "#FFFF80",
				green = "#8AFF80",
				purple = "#9580FF",
				cyan = "#80FFEA",
				pink = "#FF80BF",
				bright_red = "#FF6E6E",
				bright_green = "#69FF94",
				bright_yellow = "#FFFFA5",
				bright_blue = "#D6ACFF",
				bright_magenta = "#FF92DF",
				bright_cyan = "#A4FFFF",
				bright_white = "#FFFFFF",
				menu = "#21222C",
				visual = "#3E4452",
				gutter_fg = "#4B5263",
				nontext = "#3B4048",
			}
			require("dracula").setup({
				-- customize dracula color palette
				colors = colors,
				-- use transparent background
				transparent_bg = false, -- default false
				-- set custom lualine background color
				lualine_bg_color = "#44475a", -- default nil
				-- overrides the default highlights see `:h synIDattr`
				overrides = {
					-- https://github.com/Mofiqul/dracula.nvim/blob/main/lua/dracula/groups.lua
					Comment = { fg = colors.comment, italic = false },
					Constant = { fg = colors.yellow, italic = false },
					Keyword = { fg = colors.cyan, italic = false },
					DiagnosticUnderlineError = { fg = colors.red, italic = false, underline = true },
					Special = { fg = colors.green },
					["@keyword"] = { fg = colors.pink, italic = false },
					["@keyword.function"] = { fg = colors.pink },
					["@keyword.conditional"] = { fg = colors.pink, italic = false },
					["@variable.member"] = { fg = colors.purple },
					["@variable.parameter"] = { fg = colors.orange, italic = false },
					["@constant"] = { fg = colors.purple, italic = false },
					["@type"] = { fg = colors.bright_cyan, italic = false },
					["@number"] = { fg = colors.purple, italic = false },
					["@lsp.type.parameter"] = { fg = colors.orange, italic = false },
					NormalFloat = { fg = colors.fg, bg = colors.bg_light },
					TelescopeNormal = { fg = colors.fg, bg = colors.bg_light },
					TelescopePromptBorder = { fg = colors.cyan },
					TelescopeResultsBorder = { fg = colors.cyan },
					TelescopePreviewBorder = { fg = colors.cyan },
					FloatBorder = { fg = colors.cyan },
					VertSplit = { fg = colors.cyan },
					WinSeparator = { fg = colors.cyan },
				},
			})
		end,
	},
}
