return {
	{
		"neovim/nvim-lspconfig",
		event = { "BufReadPost" },
		cmd = { "LspInfo", "LspInstall", "LspUninstall", "Mason" },
		dependencies = {
			"williamboman/mason.nvim",
			"williamboman/mason-lspconfig.nvim",
			"hrsh7th/cmp-nvim-lsp",
			"stevearc/conform.nvim",
			"folke/neodev.nvim",
			{ "j-hui/fidget.nvim", tag = "legacy" },
			{
				"pmizio/typescript-tools.nvim",
				dependencies = { "nvim-lua/plenary.nvim" },
			},
			{
				"mrcjkb/rustaceanvim",
				ft = { "rust" },
			},
		},
		config = function()
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
				ruby_lsp = {
					cmd = { "ruby-lsp --experimental" },
				},
				gopls = {},
				nginx_language_server = {},
				zls = {},
				eslint = {},
			}

			local default_handlers = {
				["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, { border = "rounded" }),
				["textDocument/signatureHelp"] = vim.lsp.with(vim.lsp.handlers.signature_help, { border = "rounded" }),
			}

			local capabilities = vim.lsp.protocol.make_client_capabilities()
			local default_capabilities = require("cmp_nvim_lsp").default_capabilities(capabilities)

			local on_attach = function(client, buffer)
				-- Keybinds
				M.n("gh", "<cmd>lua vim.lsp.buf.hover()<cr>")
				M.n("gr", "<cmd>lua vim.lsp.buf.rename()<cr>")
				M.n("df", "<cmd>lua vim.diagnostic.open_float()<cr>")
				M.n("ca", "<cmd>lua vim.lsp.buf.code_action()<cr>")
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

			-- Conform (Formatting)
			require("conform").setup({
				formatters_by_ft = {
					lua = { "stylua" },
					javascript = { { "prettierd", "prettier" } },
					typescript = { { "prettierd", "prettier" } },
					svelte = { { "prettierd", "prettier" } },
				},
				format_on_save = {
					timeout = 500,
					lsp_fallback = true,
				},
			})

			-- Typescript Tools
			require("typescript-tools").setup({
				on_attach = on_attach,
				capabilities = default_capabilities,
				settings = {
					expose_as_code_action = { "add_missing_imports" },
				},
			})

			-- Rust Tools
			vim.g.rustaceanvim = {
				server = {
					on_attach = on_attach,
					capabilities = default_capabilities,
				},
			}

			require("lspconfig.ui.windows").default_options.border = "rounded"

			vim.diagnostic.config({
				float = {
					border = "rounded",
				},
			})
		end,
	},
}
