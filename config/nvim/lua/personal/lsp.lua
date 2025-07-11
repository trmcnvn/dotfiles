vim.diagnostic.config({
	virtual_text = false,
	virtual_lines = false,
	float = {
		border = "single",
	},
})

vim.api.nvim_create_autocmd("LspAttach", {
	callback = function(ev)
		local client = vim.lsp.get_client_by_id(ev.data.client_id)
		if client and client:supports_method("textDocument/completion") then
			vim.lsp.completion.enable(true, client.id, ev.buf, { autotrigger = false })
		end

		if client and client:supports_method("textDocument/documentColor") then
			vim.lsp.document_color.enable(true, ev.buf, { style = "virtual" })
		end

		if client and client:supports_method("textDocument/foldingRange") then
			local win = vim.api.nvim_get_current_win()
			vim.wo[win][0].foldexpr = "v:lua.vim.lsp.foldexpr()"
		end
	end,
})

-- harper_ls
vim.lsp.config("harper_ls", {
	filetypes = { "markdown" },
	settings = {
		["harper-ls"] = {
			dialect = "Australian",
		},
	},
})

-- lua_ls
vim.lsp.config("lua_ls", {
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

-- ruby_lsp
vim.lsp.config("ruby_lsp", {
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
