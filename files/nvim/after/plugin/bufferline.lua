local status, bufferline = pcall(require, "bufferline")
if (not status) then return end

bufferline.setup {
  --highlights = require("catppuccin.groups.integrations.bufferline").get(),
  options = {
    mode = "buffers",
    separator_style = "thin",
    always_show_bufferline = false,
    show_buffer_close_icons = false,
    show_close_icon = false,
    color_icons = true
  }
}

local M = require("utils.keymaps")
M.n("<Tab>", "<cmd>BufferLineCycleNext<CR>")
M.n("<S-Tab>", "<cmd>BufferLineCyclePrev<CR>")
M.n("<C-w>", "<cmd>bd<CR>")
