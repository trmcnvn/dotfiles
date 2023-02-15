local status, kanagawa = pcall(require, "kanagawa")
if (not status) then return end

kanagawa.setup({
  undercurl = true,
  commentStyle = { italic = false },
  functionStyle = {},
  keywordStyle = {},
  statementStyle = {},
  typeStyle = {},
  variablebuiltinStyle = { italic = false },
  specialReturn = true,
  specialException = true,
  transparent = false,
  dimInactive = false,
  globalStatus = true,
  terminalColors = true,
  colors = {},
  overrides = {},
  theme = "default"
})

vim.cmd [[colorscheme kanagawa]]
