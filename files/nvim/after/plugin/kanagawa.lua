local status, kanagawa = pcall(require, "kanagawa")
if (not status) then return end

kanagawa.setup({
  undercurl = true,
  commentStyle = { italic = false },
  functionStyle = {},
  keywordStyle = { italic = false },
  statementStyle = { bold = false },
  typeStyle = {},
  transparent = false,
  dimInactive = false,
  terminalColors = true,
  colors = {
    palette = {},
    theme = { wave = {}, lotus = {}, dragon = {}, all = {} }
  },
  overrides = function(colors)
    return {}
  end,
})

-- vim.cmd("colorscheme kanagawa-dragon")
