local M = require("utils.keymaps")

-- Keymap defaults
M.n("<Space>", "<Nop>", { silent = true })
M.v("<Space>", "<Nop>", { silent = true })
-- Word wrap fix
M.n("k", "v:count == 0 ? 'gk' : 'k'", { expr = true, silent = true })
M.n("j", "v:count == 0 ? 'gj' : 'j'", { expr = true, silent = true })
M.n("<down>", "v:count == 0 ? 'gj' : 'j'", { expr = true, silent = true })
M.n("<up>", "v:count == 0 ? 'gk' : 'k'", { expr = true, silent = true })
-- LazyGit
M.n("<leader>lg", "<cmd>LazyGit<CR>")
-- Harpoon
M.n("<C-\\>", "<cmd>lua require(\"harpoon.mark\").add_file()<CR>")
M.n("<C-[>", "<cmd>lua require(\"harpoon.ui\").nav_prev()<CR>")
M.n("<C-]>", "<cmd>lua require(\"harpoon.ui\").nav_next()<CR>")
-- Other
M.n("<A-a>", "gg<S-v>G")     -- Select all
M.n("<A-s>", "<cmd>w!<CR>")  -- Save
M.n("te", "<cmd>enew<CR>")   -- New tab
M.n("zv", "<cmd>vsplit<CR>") -- Vertical split
M.e("z<left>", "<C-w>h")
M.e("z<up>", "<C-w>k")
M.e("z<down>", "<C-w>j")
M.e("z<right>", "<C-w>l")
-- Horizontal nav
M.n("<C-d>", "<C-d>zz")
M.n("<C-u>", "<C-u>zz")
-- Floating term
M.n("<leader>t", function() require("lazy.util").float_term() end)
M.t("<esc>", "<c-\\><c-n>")
-- Buffers
M.n("<Tab>", "<cmd>bnext<CR>")
M.n("<S-Tab>", "<cmd>bprev<CR>")
M.n("<A-w>", "<cmd>bd<CR>")
