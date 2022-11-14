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
M.n("sv", "<cmd>vsplit<CR>") -- Vertical split
M.e("s<left>", "<C-w>h")
M.e("s<up>", "<C-w>k")
M.e("s<down>", "<C-w>j")
M.e("s<right>", "<C-w>l")
M.e("sh", "<C-w>h")
M.e("sk", "<C-w>k")
M.e("sj", "<C-w>j")
M.e("sl", "<C-w>l")
