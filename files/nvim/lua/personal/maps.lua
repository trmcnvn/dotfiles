local M = require("utils.keymaps")

-- LazyGit
M.n("<leader>lg", "<cmd>LazyGit<CR>")
-- Harpoon
M.n("<C-\\>", "<cmd>lua require(\"harpoon.mark\").add_file()<CR>")
M.n("<C-[>", "<cmd>lua require(\"harpoon.ui\").nav_prev()<CR>")
M.n("<C-]>", "<cmd>lua require(\"harpoon.ui\").nav_next()<CR>")
-- Other
M.n("<C-a>", "gg<S-v>G") -- Select all
M.n("<C-s>", "<cmd>w<CR>") -- Save
M.n("te", "<cmd>tabedit<CR>") -- New tab
M.n("zv", "<cmd>vsplit<CR>") -- Vertical split
M.e("z<left>", "<C-w>h")
M.e("z<up>", "<C-w>k")
M.e("z<down>", "<C-w>j")
M.e("z<right>", "<C-w>l")
-- Horizontal nav
M.n("<C-d>", "<C-d>zz")
M.n("<C-u>", "<C-u>zz")
