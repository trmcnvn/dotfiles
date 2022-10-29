require("tokyonight").setup({
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
})

vim.cmd [[colorscheme tokyonight]]
