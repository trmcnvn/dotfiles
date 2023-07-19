require("rose-pine").setup {
	variant = "main",
	dark_variant = "main",
	disable_italics = true,
	disable_background = false,
	disable_float_background = false,
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
		-- Notify
		NotifyBackground = { bg = "none" },
		-- Fidget
		FidgetTitle = { fg = "subtle" },
		FidgetTask = { fg = "subtle" },
		-- Express Line
		ElNormal = { fg = "base", bg = "rose", bold = true },
		ElInsert = { fg = "base", bg = "foam", bold = true },
		ElVisual = { fg = "base", bg = "iris", bold = true },
		ElVisualLine = { fg = "base", bg = "iris", bold = true },
		ElVisualBlock = { fg = "base", bg = "iris", bold = true },
		ElReplace = { fg = "base", bg = "love", bold = true },
		ElTerm = { fg = "base", bg = "pine", bold = true },
		ElCommand = { fg = "base", bg = "gold", bold = true },
	}
}

vim.cmd [[colorscheme rose-pine]]
