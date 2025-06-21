local M = require("utils.capabilities")

return M.with_capabilities({
	filetypes = { "markdown" },
	settings = {
		["harper-ls"] = {
			dialect = "Australian",
		},
	},
})
