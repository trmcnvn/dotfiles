require("rose-pine").setup({
  disable_italics = true,
  disable_background = false,
  highlight_groups = {
    Comment = { fg = "muted" },
    TelescopeBorder = { fg = "highlight_high" },
    TelescopeNormal = { fg = "subtle" },
    TelescopePromptNormal = { fg = "text" },
    TelescopeSelection = { fg = "text" },
    TelescopeSelectionCaret = { fg = "rose", bg = "rose" },
  }
})
vim.cmd("colorscheme rose-pine")
