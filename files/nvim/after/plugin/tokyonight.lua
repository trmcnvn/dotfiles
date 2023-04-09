local status, tokyonight = pcall(require, "tokyonight")
if (not status) then return end

tokyonight.setup({
  style = "night",
  transparent = false,
  terminal_colors = true,
  styles = {
    comments = { italic = false },
    keywords = { italic = false },
    functions = { italic = false },
    strings = { italic = false },
    variables = { italic = false },
    sidebars = "dark",
    floats = "dark",
  },
  sidebars = { "qf", "help", "vista_kind", "packer", "terminal" },
  hide_inactive_statusline = true,
})

--vim.cmd [[colorscheme tokyonight]]
