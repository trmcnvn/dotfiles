require("rose-pine").setup({
  variant = "main",
  dark_variant = "main",
  disable_italics = true,
  highlight_groups = {
    Comment = { fg = "muted" },
    ColorColumn = { bg = 'rose' },
    -- Blend colours against the "base" background
    CursorLine = { bg = 'foam', blend = 10 },
    StatusLine = { fg = 'love', bg = 'love', blend = 10 },
    -- Telescope
    TelescopeBorder = { fg = "highlight_high" },
    TelescopeNormal = { fg = "subtle" },
    TelescopePromptNormal = { fg = "text" },
    TelescopeSelection = { fg = "text" },
    TelescopeSelectionCaret = { fg = "rose", bg = "rose" },
    -- nvim-cmp
    CmpItemAbbrMatchFuzzy = { fg = "foam", bold = true },
    CmpItemAbbrMatch = { fg = "foam", bold = true },
    CmpItemAbbrDeprecated = { fg = "subtle", strikethrough = true },
    CmpItemKindInterface = { fg = "rose" },
    CmpItemKindVariable = { fg = "rose" },
    CmpItemKindText = { fg = "rose" },
    CmpItemKindFunction = { fg = "love" },
    CmpItemKindMethod = { fg = "love" },
    CmpItemKindProperty = { fg = "text" },
    CmpItemKindUnit = { fg = "text" },
    CmpItemKindKeyword = { fg = "text" },
    CmpItemKindCopilot = { fg = "gold" }
  }
})
vim.cmd("colorscheme rose-pine")
