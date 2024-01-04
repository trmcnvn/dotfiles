return {
	{
		"neovim/nvim-lspconfig",
		event = { "BufReadPost" },
		cmd = { "LspInfo", "LspInstall", "LspUninstall", "Mason" },
		dependencies = {
			"williamboman/mason.nvim",
			"williamboman/mason-lspconfig.nvim",
			"hrsh7th/cmp-nvim-lsp",
			"nvimtools/none-ls.nvim",
			"folke/neodev.nvim",
			{ "j-hui/fidget.nvim", tag = "legacy" },
		},
		config = function()
			local null_ls = require("null-ls")
			local M = require("utils.keymaps")

			require("neodev").setup()
			require("mason").setup({
				ui = {
					border = "rounded",
				},
			})
			require("mason-lspconfig").setup()
			local servers = {
				lua_ls = {
					settings = {
						Lua = {
							workspace = { checkThirdParty = false },
							telemetry = { enabled = false },
						},
					},
				},
				svelte = {
					settings = {
						svelte = {
							plugin = {
								svelte = {
									format = {
										enable = false,
									},
								},
							},
						},
					},
				},
				tailwindcss = {
					filetypes = { "html", "css", "svelte" },
					settings = {
						tailwindCSS = {
							hovers = false,
							codeActions = false,
						},
					},
				},
				rust_analyzer = {},
				ruby_ls = {},
				gopls = {},
				nginx_language_server = {},
			}

			local default_handlers = {
				["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, { border = "rounded" }),
				["textDocument/signatureHelp"] = vim.lsp.with(vim.lsp.handlers.signature_help, { border = "rounded" }),
			}

			local capabilities = vim.lsp.protocol.make_client_capabilities()
			local default_capabilities = require("cmp_nvim_lsp").default_capabilities(capabilities)

			-- textDocument/diagnostic support until 0.10.0 is released
			_timers = {}
			local function setup_diagnostics(client, buffer)
				if require("vim.lsp.diagnostic")._enable then
					return
				end
				local diagnostic_handler = function()
					local params = vim.lsp.util.make_text_document_params(buffer)
					client.request("textDocument/diagnostic", { textDocument = params }, function(err, result)
						local diagnostic_items = {}
						if result then
							diagnostic_items = result.items
						end
						vim.lsp.diagnostic.on_publish_diagnostics(
							nil,
							vim.tbl_extend("keep", params, { diagnostics = diagnostic_items }),
							{ client_id = client.id }
						)
					end)
				end
				diagnostic_handler() -- to request diagnostics on buffer when first attaching
				vim.api.nvim_buf_attach(buffer, false, {
					on_lines = function()
						if _timers[buffer] then
							vim.fn.timer_stop(_timers[buffer])
						end
						_timers[buffer] = vim.fn.timer_start(200, diagnostic_handler)
					end,
					on_detach = function()
						if _timers[buffer] then
							vim.fn.timer_stop(_timers[buffer])
						end
					end,
				})
			end

			local on_attach = function(client, buffer)
				-- Keybinds
				M.n("gh", "<cmd>lua vim.lsp.buf.hover()<cr>")
				M.n("gr", "<cmd>lua vim.lsp.buf.rename()<cr>")
				M.n("df", "<cmd>lua vim.diagnostic.open_float()<cr>")
				M.n("ca", "<cmd>lua vim.lsp.buf.code_actions()<cr>")
				-- Remove with Neovim 0.10+
				setup_diagnostics(client, buffer)
				vim.api.nvim_buf_create_user_command(buffer, "Format", function(_)
					vim.lsp.buf.format({ bufnr = buffer, timeout_ms = 3000 })
				end, { desc = "LSP: Format current buffer with LSP" })
			end

			for name, config in pairs(servers) do
				require("lspconfig")[name].setup({
					capabilities = default_capabilities,
					filetypes = config.filetypes,
					handlers = vim.tbl_deep_extend("force", {}, default_handlers, config.handlers or {}),
					on_attach = on_attach,
					settings = config.settings,
				})
			end

			local formatting = null_ls.builtins.formatting
			local diagnostics = null_ls.builtins.diagnostics
			local code_actions = null_ls.builtins.code_actions

			null_ls.setup({
				border = "rounded",
				sources = {
					formatting.prettier,
					formatting.stylua,
					diagnostics.eslint_d.with({
						condition = function(utils)
							return utils.root_has_file({ ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json" })
						end,
					}),
					code_actions.eslint_d.with({
						condition = function(utils)
							return utils.root_has_file({ ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json" })
						end,
					}),
				},
			})

			require("lspconfig.ui.windows").default_options.border = "rounded"

			vim.diagnostic.config({
				float = {
					border = "rounded",
				},
			})
		end,
	},
}
