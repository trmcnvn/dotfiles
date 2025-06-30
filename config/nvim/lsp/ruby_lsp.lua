local M = require("utils.capabilities")
return M.with_capabilities({
	cmd = { "ruby-lsp" },
	filetypes = { "ruby", "eruby" },
	root_dir = function(bufnr, on_dir)
		local root = vim.fs.root(bufnr, { ".git", "Gemfile", "Rakefile", "config.ru" })
		on_dir(root)
	end,
	init_options = {
		formatter = "rubocop",
		linters = { "rubocop" },
		indexing = {
			includedPatterns = { "**/*.rb", "**/*.rake", "**/*.ru" },
			excludedPatterns = { "**/node_modules/**", "**/vendor/**", "**/tmp/**" },
		},
		addonSettings = {
			["Ruby LSP Rails"] = {
				enablePendingMigrationsPrompt = false,
			},
		},
	},
	settings = {
		rubyLsp = {
			enabledFeatures = {
				diagnostics = true,
				documentHighlights = true,
				documentSymbols = true,
				foldingRanges = true,
				selectionRanges = true,
				semanticHighlighting = true,
				formatting = true,
				codeActions = true,
			},
		},
	},
	on_attach = function(client, bufnr)
		-- Force re-index when attaching
		vim.defer_fn(function()
			if client.server_capabilities.workspaceSymbolProvider then
				client.request("workspace/executeCommand", {
					command = "rubyLsp.reloadProject",
					arguments = {},
				})
			end
		end, 1000)
	end,
})
