require("rose-pine").setup {
	variant = "main",
	dark_variant = "main",
	disable_italics = true,
	disable_background = false,
	disable_float_background = false,
	highlight_groups = {
		Comment = { fg = "muted", italic = true },
		Constant = { fg = "gold", italic = true },
		Keyword = { fg = "pine", italic = true },
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
		-- Notify
		NotifyBackground = { bg = "none" },
		-- Fidget
		FidgetTitle = { fg = "subtle" },
		FidgetTask = { fg = "subtle" },
		-- Express Line
		ElNormal = { fg = "rose" },
		ElInsert = { fg = "foam" },
		ElVisual = { fg = "iris" },
		ElVisualLine = { fg = "iris" },
		ElVisualBlock = { fg = "iris" },
		ElReplace = { fg = "love" },
		ElTerm = { fg = "pine" },
		ElCommand = { fg = "gold" },
	}
}

vim.cmd [[colorscheme rose-pine]]
