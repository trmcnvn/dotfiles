local status, trouble = pcall(require, "trouble")
if (not status) then return end

trouble.setup({
  mode = "document_diagnostics",
  use_diagnostic_signs = true
})

function ToggleTroubleAuto()
  vim.defer_fn(function()
    vim.cmd('cclose')
    trouble.open('quickfix')
  end, 0)
end

vim.cmd [[
augroup trouble
  autocmd!
  autocmd BufWinEnter quickfix silent lua ToggleTroubleAuto()
augroup END
]]

local M = require("utils.keymaps")
M.n("<leader>xx", "<cmd>TroubleToggle<cr>")
M.n("<leader>xq", "<cmd>TroubleToggle quickfix<cr>")
