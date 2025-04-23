local M = require("utils.capabilities")
return M.with_capabilities({
	cmd = { "nginx-language-server" },
	filetypes = { "nginx" },
	root_markers = { "nginx.conf", ".git" },
})
