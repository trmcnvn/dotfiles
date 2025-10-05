vim.diagnostic.config({
	virtual_text = false,
	virtual_lines = false,
	float = {
		border = "single",
	},
})

-- Special Features
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

		-- if client:supports_method("textDocument/inlineCompletion") then
		-- vim.lsp.inline_completion.enable()
		-- end
	end,
})

-- harper_ls
vim.lsp.config(
	"harper_ls",
	vim.tbl_deep_extend("force", vim.lsp.config.harper_ls or {}, {
		filetypes = { "markdown" },
		settings = {
			["harper-ls"] = {
				dialect = "Australian",
			},
		},
	})
)

-- lua_ls
vim.lsp.config(
	"lua_ls",
	vim.tbl_deep_extend("force", vim.lsp.config.lua_ls or {}, {
		settings = {
			Lua = {
				runtime = { version = "LuaJIT" },
				diagnostics = {
					globals = {
						"vim",
						"MiniIcons",
						"MiniCompletion",
						"MiniBufremove",
						"MiniPick",
						"MiniDiff",
					},
				},
				workspace = {
					checkThirdParty = false,
					library = { vim.api.nvim_get_runtime_file("", true) },
				},
				telemetry = { enabled = false },
			},
		},
	})
)

-- ruby_lsp
vim.lsp.config(
	"ruby_lsp",
	vim.tbl_deep_extend("force", vim.lsp.config.ruby_lsp or {}, {
		mason = false,
		init_options = {
			addonSettings = {
				["Ruby LSP Rails"] = {
					enablePendingMigrationsPrompt = false,
				},
			},
		},
	})
)
vim.lsp.enable("ruby_lsp") -- Ruby LSP is installed by the Gem, not managed by Mason

-- Capabilities
local M = require("utils.capabilities")
vim.lsp.config("*", M.with_capabilities({}))
