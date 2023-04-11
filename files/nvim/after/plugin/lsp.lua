local ok, mason = pcall(require, "mason")
if not ok then return end

local ok_cmp, cmp_lsp = pcall(require, "cmp_nvim_lsp")
if not ok_cmp then return end

local mason_cfg = require("mason-lspconfig")

local augroup_format = vim.api.nvim_create_augroup("format", { clear = true })
local on_attach = function(_, bufnr)
	vim.api.nvim_clear_autocmds({ group = augroup_format, buffer = bufnr })
	vim.api.nvim_create_autocmd("BufWritePre", {
		group = augroup_format,
		buffer = bufnr,
		callback = function() vim.lsp.buf.format({ bufnr = bufnr }) end
	})
end

local capabilities = vim.lsp.protocol.make_client_capabilities()
vim.tbl_deep_extend("force", capabilities, cmp_lsp.default_capabilities())
capabilities.textDocument.codeLens = { dynamicRegistration = false }

local on_init = function(client)
	client.config.flags = client.config.flags or {}
	client.config.flags.allow_incremental_sync = true
end

mason.setup {}
mason_cfg.setup {}
mason_cfg.setup_handlers {
	function(server_name)
		require("lspconfig")[server_name].setup {
			on_init = on_init,
			on_attach = on_attach,
			capabilities = capabilities,
			flags = {
				debounce_text_changes = nil
			}
		}
	end,
	["tsserver"] = function()
		require("lspconfig")["tsserver"].setup {
			init_options = require("nvim-lsp-ts-utils").init_options,
			on_init = on_init,
			on_attach = function(client)
				on_attach(client)
				require("nvim-lsp-ts-utils").setup { auto_inlay_hints = false }
				require("nvim-lsp-ts-utils").setup_client(client)
			end,
			capabilities = capabilities,
			cmd = { "typescript-language-server", "--stdio" },
		}
	end,
	["svelte"] = function()
		require("lspconfig")["svelte"].setup {
			on_init = on_init,
			on_attach = on_attach,
			capabilities = capabilities,
			settings = {
				svelte = {
					["enable-ts-plugin"] = true
				}
			}
		}
	end
}

require("null-ls").setup {
	sources = {
		require("null-ls").builtins.formatting.prettierd.with({ extra_filetypes = { "svelte" } })
	}
}

vim.lsp.handlers["textDocument/definition"] = function(_, result)
	if not result or vim.tbl_isempty(result) then
		print "[LSP] Could not find definition"
		return
	end

	if vim.tbl_islist(result) then
		vim.lsp.util.jump_to_location(result[1], "utf-8")
	else
		vim.lsp.util.jump_to_location(result, "utf-8")
	end
end

vim.lsp.handlers["textDocument/publishDiagnostics"] = vim.lsp.with(
	vim.lsp.diagnostic.on_publish_diagnostics, {
		signs = {
			severity_limit = "Error"
		},
		underline = {
			severity_limit = "Warning"
		},
		virtual_text = true,
	}
)
