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
		if not client then
			return
		end

		if client:supports_method("textDocument/completion") then
			vim.lsp.completion.enable(true, client.id, ev.buf, { autotrigger = false })
		end

		if client:supports_method("textDocument/documentColor") then
			vim.lsp.document_color.enable(true, ev.buf, { style = "virtual" })
		end

		if client:supports_method("textDocument/foldingRange") then
			local win = vim.api.nvim_get_current_win()
			vim.wo[win][0].foldexpr = "v:lua.vim.lsp.foldexpr()"
		end

		vim.lsp.inline_completion.enable()
	end,
})

-- LSP Base
local M = require("utils.capabilities")
vim.lsp.config("*", M.with_capabilities({}))

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
	mason = false,
	init_options = {
		formatter = "rubocop_internal",
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
		-- rubyLsp/workspace/dependencies
		vim.api.nvim_buf_create_user_command(bufnr, "ShowRubyDeps", function(opts)
			local params = vim.lsp.util.make_text_document_params()
			local showAll = opts.args == "all"

			client:request("rubyLsp/workspace/dependencies", params, function(error, result)
				if error then
					print("Error showing deps: " .. error)
					return
				end

				local qf_list = {}
				for _, item in ipairs(result) do
					if showAll or item.dependency then
						table.insert(qf_list, {
							text = string.format("%s (%s) - %s", item.name, item.version, item.dependency),
							filename = item.path,
						})
					end
				end

				vim.fn.setqflist(qf_list)
				vim.cmd("copen")
			end, bufnr)
		end, {
			nargs = "?",
			complete = function()
				return { "all" }
			end,
		})

		-- Force re-index when attaching
		vim.defer_fn(function()
			if client.server_capabilities.workspaceSymbolProvider then
				client:request("workspace/executeCommand", {
					command = "rubyLsp.reloadProject",
					arguments = {},
				})
			end
		end, 1000)
	end,
})
vim.lsp.enable("ruby_lsp") -- Not using Mason install for this one due to issues between Ruby versions
