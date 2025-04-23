return {
	{
		"mrcjkb/rustaceanvim",
		ft = "rust",
		init = function()
			local M = require("utils.capabilities")
			vim.g.rustaceanvim = {
				server = M.with_capabilities({}),
			}
		end,
	},
}
