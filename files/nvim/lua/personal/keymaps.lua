local M = {}
local function bind(op, outer_opts)
  outer_opts = outer_opts or {noremap = true}
  return function(lhs, rhs, opts)
    opts = vim.tbl_extend("force", outer_opts, opts or {})
    vim.keymap.set(op, lhs, rhs, opts)
  end
end
M.nnoremap = bind("n")
-- Telescope Binds
M.nnoremap("<leader>ff", "<cmd>Telescope find_files<CR>")
M.nnoremap("<leader>fg", "<cmd>Telescope live_grep<CR>")
M.nnoremap("<leader>fb", "<cmd>Telescope buffers<CR>")
M.nnoremap("<leader>fh", "<cmd>Telescope harpoon marks<CR>")
-- Tree Binds
M.nnoremap("<leader>e", "<cmd>NvimTreeToggle<CR>")
-- LSP Binds

-- LazyGit
M.nnoremap("<leader>lg", "<cmd>LazyGit<CR>")
-- Tabs
M.nnoremap("<C-w>", "<cmd>BufferClose<CR>")
M.nnoremap("<C-]>", "<cmd>BufferNext<CR>")
M.nnoremap("<C-[>", "<cmd>BufferPrev<CR>")
-- Harpoon
M.nnoremap("<C-\\>", "<cmd>lua require(\"harpoon.mark\").add_file()<CR>")
M.nnoremap("<C-.>", "<cmd>lua require(\"harpoon.ui\").nav_prev()<CR>")
M.nnoremap("<C-/>", "<cmd>lua require(\"harpoon.ui\").nav_next()<CR>")
