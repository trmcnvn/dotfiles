return {
  {
    "romgrk/barbar.nvim",
    event = "VeryLazy",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    init = function()
      vim.g.barbar_auto_setup = false
    end,
    config = function()
      require("bufferline").setup({
        animation = false,
        icons = {
          button = "x",
          modified = { button = "●" },
        },
      })

      local M = require("utils.keymaps")
      M.n("<Tab>", "<cmd>BufferNext<cr>")
      M.n("<S-Tab>", "<cmd>BufferPrevious<cr>")
      M.n("<A-w>", "<cmd>BufferClose<cr>")
    end
  },
}
