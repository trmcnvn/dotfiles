local status, catppuccin = pcall(require, "catppuccin")
if (not status) then return end

catppuccin.setup {
  flavour = "mocha",
  term_colors = true,
  styles = {
    comments = {},
    conditionals = {},
    loops = {},
    functions = {},
    keywords = {},
    strings = {},
    variables = {},
    numbers = {},
    booleans = {},
    properties = {},
    types = {},
    operators = {},
  },
  integrations = {
    cmp = true,
    dashboard = true,
    harpoon = true,
    mason = true,
    telescope = true,
    treesitter = true,
  },
}

--vim.cmd [[colorscheme catppuccin]]
