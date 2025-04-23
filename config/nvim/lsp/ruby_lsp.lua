local M = require("utils.capabilities")
return M.with_capabilities({
	cmd = { "ruby-lsp" },
	filetypes = { "ruby", "eruby" },
	root_markers = { ".git", "Gemfile" },
	init_options = {
		formatter = "rubocop",
		linters = { "rubocop" },
		addonSettings = {
			["Ruby LSP Rails"] = {
				enablePendingMigrationsPrompt = false,
			},
		},
	},
})
