local status, lualine = pcall(require, "lualine")
if (not status) then return end

lualine.setup({
  options = {
    theme = "auto",
    icons_enabled = true,
    section_separators = { left = '', right = '' },
    component_separators = { left = '', right = '' },
    disabled_filetypes = { statusline = { "dashboard" } }
  },
  sections = {
    lualine_a = { "mode" },
    lualine_b = { "branch" },
    lualine_c = {
      -- { "filename", path = 0, symbols = { modified = "[~]", readonly = "", unnamed = "" } },
      {
        "buffers",
        symbols = { modified = " [~]", alternate_file = "", directory = "" },
        max_length = vim.o.columns * 2 / 3
      }
    },
    lualine_x = {
      { require("lazy.status").updates, cond = require("lazy.status").has_updates },
      {
        "diff",
        symbols = {
          added = "+",
          modified = "~",
          removed = "-",
        }
      },
    },
    lualine_y = {
      { "progress", separator = " ",                  padding = { left = 1, right = 0 } },
      { "location", padding = { left = 0, right = 1 } }
    },
    lualine_z = {
      { "datetime", style = "%H:%M" }
    }
  },
  extensions = { "neo-tree", "lazy", "quickfix" },
  tabline = {}
})
