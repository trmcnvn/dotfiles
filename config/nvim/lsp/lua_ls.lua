local M = require("utils.capabilities")

return M.with_capabilities({
	cmd = { "lua-language-server" },
	filetypes = { "lua" },
	root_markers = {
		".luarc.json",
		".luarc.jsonc",
		".luacheckrc",
		".stylua.toml",
		"stylua.toml",
		"selene.toml",
		"selene.yml",
		".git",
	},
	settings = {
		Lua = {
			runtime = { version = "LuaJIT" },
			diagnostics = { globals = { "vim", "MiniIcons", "Snacks" } },
			completion = { callSnippet = { "Replace" } },
			workspace = {
				checkThirdParty = false,
				library = { vim.env.VIMRUNTIME },
			},
			telemetry = { enabled = false },
		},
	},
})
