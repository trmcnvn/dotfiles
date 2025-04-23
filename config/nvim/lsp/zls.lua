local M = require("utils.capabilities")
return M.with_capabilities({
	cmd = { "zls" },
	filetypes = { "zig", "zir" },
	root_markers = { "build.zig" },
	settings = { autoformat = true },
	on_init = function(_, _)
		vim.g.zig_fmt_parse_errors = 0
		vim.g.zig_fmt_autosave = 0
	end,
})
