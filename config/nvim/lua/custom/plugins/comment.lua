return {
	{
		"numToStr/Comment.nvim",
		dependencies = { "JoosepAlviste/nvim-ts-context-commentstring" },
		config = function()
			require("Comment").setup {
				pre_hook = require("ts_context_commentstring.integrations.comment_nvim").create_pre_hook(),
				opleader = {
					line = "gc",
					block = "gb"
				},
				mappings = {
					basic = true,
					extra = true
				},
				toggler = {
					line = "gcc",
					block = "gbb",
				},
			}
		end,
	}
}
