local ok, pairs = pcall(require, "nvim-autopairs")
if not ok then return end

pairs.setup {
	check_ts = true,
	disable_filetype = { "TelescopePrompt" }
}

local pairs_cmp = require("nvim-autopairs.completion.cmp")
local cmp = require("cmp")

cmp.event:on("confirm_done", pairs_cmp.on_confirm_done {})
