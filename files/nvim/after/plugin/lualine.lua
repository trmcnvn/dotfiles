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
    lualine_a = { { "mode", fmt = function(str) return str:sub(1, 1) end } },
    lualine_b = { "branch" },
    lualine_c = {
      {
        "filetype",
        icon_only = true,
        separator = "",
        padding = {
          left = 1,
          right = 0
        }
      },
      { "filename", path = 1, symbols = { modified = "  ", readonly = "", unnamed = "" } },
    },
    lualine_x = {
      { require("lazy.status").updates, cond = require("lazy.status").has_updates },
      {
        "diff",
        symbols = {
          added = " ",
          modified = " ",
          removed = " ",
        }
      },
    },
    lualine_y = {
      { "progress", separator = " ",                  padding = { left = 1, right = 0 } },
      { "location", padding = { left = 0, right = 1 } }
    },
    lualine_z = {
      function() return " " .. os.date("%R") end
    }
  },
  extensions = { "nvim-tree", "lazy" },
  tabline = {}
})
