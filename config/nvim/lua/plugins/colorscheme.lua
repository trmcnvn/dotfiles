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
	{
		"catppuccin/nvim",
		config = function()
			require("catppuccin").setup({
				integrations = {
					cmp = true,
					fidget = true,
					harpoon = true,
					illuminate = true,
					mason = true,
					telescope = true,
					treesitter = true,
					treesitter_context = true,
				},
			})
			-- vim.cmd.colorscheme("catppuccin-mocha")
		end,
	},
	{
		"craftzdog/solarized-osaka.nvim",
		config = function()
			require("solarized-osaka").setup({
				transparent = true,
				terminal_cololrs = true,
				styles = {
					comments = { italic = false },
					keywords = { italic = false },
				},
			})
		end,
	},
	{
		"rebelot/kanagawa.nvim",
		config = function()
			require("kanagawa").setup({
				transparent = false,
				theme = "dragon",
				background = {
					dark = "dragon",
					light = "lotus",
				},
				colors = {
					theme = {
						dragon = {
							ui = {
								bg = "#1a1a1a",
								bg_p2 = "#242424",
							},
						},
						wave = {},
						all = {
							ui = {
								bg_gutter = "none",
							},
						},
					},
				},
				overrides = function()
					local white = "#eae3d4"
					local orange = "#fbb570"
					local yellow = "#f4d68d"
					local pink = "#dfc1df"
					return {
						["@comment"] = { fg = "#686868" },
						["@number"] = { fg = "#94c2e5" },
						["@number.float"] = { fg = "#94c2e5" },
						["@function"] = { fg = yellow },
						["@function.call"] = { fg = yellow },
						["@function.builtin"] = { fg = yellow },
						["@keyword.import.zig"] = { fg = yellow },
						["@string.escape"] = { fg = orange },
						["@keyword"] = { fg = orange },
						["@keyword.return"] = { fg = orange },
						["@keyword.operator"] = { fg = orange },
						["@operator"] = { fg = orange },
						["@string"] = { fg = "#c7ca69" },
						["@type"] = { fg = white },
						["@boolean"] = { fg = white },
						["@constant"] = { fg = white },
						["@variable"] = { fg = white },
						["@lsp.type.variable"] = { fg = white },
						["@variable.zig"] = { fg = white },
						["@variable.member"] = { fg = white },
						["@lsp.type.property.zig"] = { fg = white },
						["@lsp.type.property.lua"] = { fg = white },
						["@lsp.type.namespace"] = { fg = white },
						["@punctuation.bracket"] = { fg = white },
						["@punctuation.delimiter"] = { fg = white },
						["@lsp.type.parameter"] = { fg = pink },
						["@lsp.type.type.zig"] = { fg = "none" },
						["@variable.parameter"] = { fg = white },
						["rustKeyword"] = { fg = orange },
						["rustStorage"] = { fg = orange },
						CursorLineNr = { fg = "none" },
					}
				end,
			})
		end,
	},
}
