return {
	pack = { src = "https://github.com/mrcjkb/rustaceanvim" },
	config = function()
		local M = require("utils.capabilities")
		vim.g.rustaceanvim = {
			server = M.with_capabilities({}),
		}
	end,
}
