local status, trouble = pcall(require, "trouble")
if (not status) then return end

trouble.setup({
  mode = "document_diagnostics",
  use_diagnostic_signs = true
})

local M = require("utils.keymaps")
M.n("<leader>xx", "<cmd>TroubleToggle<cr>")
M.n("<leader>xq", "<cmd>TroubleToggle quickfix<cr>")
