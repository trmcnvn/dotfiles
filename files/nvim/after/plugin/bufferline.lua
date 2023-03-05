local status, bufferline = pcall(require, "bufferline")
if (not status) then return end

bufferline.setup {
  --highlights = require("catppuccin.groups.integrations.bufferline").get(),
  highlights = vim.tbl_deep_extend("force", require("rose-pine.plugins.bufferline"), {
    buffer_selected = {
      italic = false,
      bold = false
    }
  }),
  options = {
    mode = "buffers",
    separator_style = "thin",
    always_show_bufferline = false,
    show_buffer_close_icons = false,
    show_buffer_icons = true,
    show_close_icon = true,
    color_icons = true,
    enfoce_regular_tabs = false
  }
}

local M = require("utils.keymaps")
M.n("<Tab>", "<cmd>BufferLineCycleNext<CR>")
M.n("<S-Tab>", "<cmd>BufferLineCyclePrev<CR>")
M.n("<C-w>", "<cmd>bd<CR>")
M.n("<C-W>", "<cmd>bd!<CR>")
