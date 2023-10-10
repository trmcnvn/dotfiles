local ok, mason = pcall(require, "mason")
if not ok then return end

local ok_lspconfig, lspconfig = pcall(require, "lspconfig")
if not ok_lspconfig then return end

local mason_cfg = require("mason-lspconfig")

-- Fidget
require("fidget").setup {
	text = { spinner = "moon" },
	align = { bottom = true },
	window = { relative = "editor", blend = 0 },
}

-- Auto format
local augroup_format = vim.api.nvim_create_augroup("format", { clear = true })
local on_attach = function(_, bufnr)
	vim.api.nvim_clear_autocmds({ group = augroup_format, buffer = bufnr })
	vim.api.nvim_create_autocmd("BufWritePre", {
		group = augroup_format,
		buffer = bufnr,
		callback = function() vim.lsp.buf.format({ bufnr = bufnr, timeout_ms = 5000 }) end
	})
end

local capabilities = lspconfig.util.default_config.capabilities
local ok_cmp, cmp_lsp = pcall(require, "cmp_nvim_lsp")
if not ok_cmp then return end
vim.tbl_deep_extend("force", capabilities, cmp_lsp.default_capabilities())
capabilities.textDocument.codeLens = { dynamicRegistration = false }

local on_init = function(client)
	client.config.flags = client.config.flags or {}
	client.config.flags.allow_incremental_sync = true
end

-- efm formatters
local format_languages = {
	javascript = {
		require("efmls-configs.linters.eslint_d"),
		require("efmls-configs.formatters.prettier_d"),
	},
	typescript = {
		require("efmls-configs.linters.eslint_d"),
		require("efmls-configs.formatters.prettier_d"),
	},
	svelte = {
		require("efmls-configs.linters.eslint_d"),
		require("efmls-configs.formatters.prettier_d"),
	},
	json = {
		require("efmls-configs.formatters.prettier_d"),
	},
	lua = { require("efmls-configs.formatters.stylua") }
}

-- LSP Servers
mason.setup {}
mason_cfg.setup {}
mason_cfg.setup_handlers {
	function(server_name)
		local servers = {
			lua_ls = {
				settings = {
					Lua = {
						runtime = { version = "LuaJIT" },
						diagnostics = { globals = { "vim" } },
						workspace = { library = vim.api.nvim_get_runtime_file("", true) },
					}
				}
			},
			solargraph = {
				cmd = { "bundle", "exec", "solargraph", "stdio" },
				settings = {
					solargraph = {
						useBundler = true,
						diagnostic = true,
						completion = true,
						hover = true,
						formatting = true,
						symbols = true,
						definitions = true,
						rename = true,
						references = true,
						folding = true
					}
				}
			},
			svelte = {
				settings = {
					svelte = {
						plugin = {
							svelte = {
								format = {
									enable = false
								}
							}
						}
					}
				}
			},
			tailwindcss = {
				filetypes = { "html", "css", "svelte" },
				settings = {
					tailwindCSS = {
						hovers = false,
						codeActions = false,
					}
				}
			},
			-- tsserver = {
			-- 	cmd = { "typescript-language-server", "--stdio" },
			-- },
			-- rust_analyzer = {
			-- 	cmd = { vim.fn.expand("$HOME/.asdf/shims/rust-analyzer") },
			-- 	settings = {
			-- 		["rust-analyzer"] = {
			-- 			inlayHints = {
			-- 				chainingHints = { enable = false },
			-- 				closingBraceHints = { enable = false },
			-- 				parameterHints = { enable = false },
			-- 				typeHints = { enable = false }
			-- 			}
			-- 		}
			-- 	}
			-- }
			efm = {
				settings = {
					languages = format_languages,
					rootMarkers = { ".git/" }
				},
				filetypes = vim.tbl_keys(format_languages),
				init_options = {
					documentFormatting = true,
					documentRangeFormatting = true
				},
			},
		}

		local opts = {}
		if servers[server_name] ~= nil then
			opts = servers[server_name]
		end

		lspconfig[server_name].setup(vim.tbl_deep_extend("force", {
			on_init = on_init,
			on_attach = on_attach,
			capabilities = capabilities,
			flags = {
				debounce_text_changes = nil
			}
		}, opts))
	end,
}

-- TypeScript
require("typescript-tools").setup({
	on_init = on_init,
	on_attach = on_attach,
	capabilities = capabilities,
	root_dir = lspconfig.util.root_pattern("package.json", "tsconfig.json", "jsconfig.json", ".git", ".gitignore"),
	settings = {
		expose_as_code_action = { "add_missing_imports" },
	}
})

-- Rust
require("rust-tools").setup({
	server = {
		on_init = on_init,
		on_attach = on_attach,
		capabilities = capabilities,
	}
})

-- LSP Handlers
vim.lsp.handlers["textDocument/publishDiagnostics"] = vim.lsp.with(
	vim.lsp.diagnostic.on_publish_diagnostics, {
		signs = {
			severity_limit = "Error"
		},
		underline = {
			severity_limit = "Warning"
		},
		virtual_text = false,
		update_in_insert = true
	}
)

vim.lsp.handlers["textDocument/hover"] = function(_, result, ctx, config)
	config = config or {}
	config.border = "rounded"
	config.focus_id = ctx.method
	if not (result and result.contents) then
		return
	end
	local markdown_lines = vim.lsp.util.convert_input_to_markdown_lines(result.contents)
	markdown_lines = vim.lsp.util.trim_empty_lines(markdown_lines)
	if vim.tbl_isempty(markdown_lines) then
		return
	end
	return vim.lsp.util.open_floating_preview(markdown_lines, 'markdown', config)
end

-- vim.lsp.with(
-- 	vim.lsp.handlers.hover, {
-- 		border = "rounded"
-- 	}
-- )

local M = require("utils.keymaps")
M.n("gh", "<cmd>lua vim.lsp.buf.hover()<cr>")
M.n("gr", "<cmd>lua vim.lsp.buf.rename()<cr>")
M.n("df", "<cmd>lua vim.diagnostic.open_float()<cr>")
M.n("ca", "<cmd>lua vim.lsp.buf.code_action()<cr>")
