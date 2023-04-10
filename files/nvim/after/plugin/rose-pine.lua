require("rose-pine").setup({
  variant = "main",
  dark_variant = "main",
  disable_italics = true,
  disable_background = true,
  disable_float_background = true,
  highlight_groups = {
    Comment = { fg = "muted" },
    ColorColumn = { bg = "rose" },
    Pmenu = { fg = "highlight_high", bg = "base" },
    PmenuSel = { fg = "text", bg = "none" },
    FloatBorder = { fg = "highlight_high" },
    -- Blend colours against the "base" background
    CursorLine = { bg = "foam", blend = 10 },
    StatusLine = { fg = "love", bg = "love", blend = 10 },
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
    CmpItemKindCopilot = { fg = "gold" }
  }
})
vim.cmd("colorscheme rose-pine")
