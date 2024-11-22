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
				"mrcjkb/rustaceanvim",
				ft = { "rust" },
			},
			-- "SmiteshP/nvim-navic",
		},
		config = function()
			local M = require("utils.keymaps")

			-- UI Customization
			require("lspconfig.ui.windows").default_options.border = "rounded"
			vim.diagnostic.config({
				float = {
					border = "rounded",
				},
			})

			require("neodev").setup()
			require("mason").setup({
				ui = {
					border = "rounded",
				},
			})
			require("mason-lspconfig").setup()

			-- Attempt to load a newly installed LSP
			local mr = require("mason-registry")
			mr:on("package:install:success", function()
				vim.defer_fn(function()
					require("lazy.core.handler.event").trigger({
						event = "FileType",
						buf = vim.api.nvim_get_current_buf(),
					})
				end, 100)
			end)

			local servers = {
				lua_ls = {
					settings = {
						Lua = {
							diagnostics = { globals = { "vim", "MiniIcons" } },
							completion = { callSnippet = { "Replace" } },
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
					mason = false,
					cmd = { vim.fn.expand("~/.asdf/shims/ruby-lsp") },
					init_options = {
						formatter = "rubocop",
						linters = { "rubocop" },
					},
				},
				gopls = {},
				nginx_language_server = {},
				zls = {},
				vtsls = {},
			}

			local default_handlers = {
				["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, { border = "rounded" }),
				["textDocument/signatureHelp"] = vim.lsp.with(vim.lsp.handlers.signature_help, { border = "rounded" }),
			}

			local capabilities = vim.lsp.protocol.make_client_capabilities()
			local default_capabilities = require("cmp_nvim_lsp").default_capabilities(capabilities)
			-- local navic = require("nvim-navic")

			local on_attach = function()
				-- if client.server_capabilities.documentSymbolProvider then
				-- navic.attach(client, buffer)
				-- end
				-- Keybinds
				M.n("gh", "<cmd>lua vim.lsp.buf.hover()<cr>")
				M.n("gn", "<cmd>lua vim.lsp.buf.rename()<cr>")
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
					cmd = config.cmd,
					init_options = config.init_options,
					mason = config.mason or true,
				})
			end

			-- Conform (Formatting)
			require("conform").setup({
				formatters_by_ft = {
					lua = { "stylua" },
					javascript = { "prettier" },
					typescript = { "prettier" },
					svelte = { "prettier" },
				},
				format_on_save = {
					timeout = 500,
					lsp_fallback = true,
				},
			})

			-- Rust Tools
			vim.g.rustaceanvim = {
				server = {
					on_attach = on_attach,
					capabilities = default_capabilities,
				},
			}
		end,
	},
}
