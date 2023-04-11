return {
	"neovim/nvim-lspconfig",
	"williamboman/mason.nvim",
	"williamboman/mason-lspconfig.nvim",
	{
		"WhoIsSethDaniel/mason-tool-installer.nvim",
		opts = {
			run_on_start = true,
			auto_update = true,
			debounce_hours = 24,
			ensure_installed = {
				"rust-analyzer",
				"lua-language-server",
				"eslint-lsp",
				"typescript-language-server",
				"solargraph",
				"svelte-language-server",
				"tailwindcss-language-server",
				"gopls",
				"prisma-language-server",
				"prettierd",
				"standardrb",
				"nginx-language-server"
			}
		}
	},
	"simrat39/inlay-hints.nvim",
	"j-hui/fidget.nvim",
	"folke/neodev.nvim",
	"jose-elias-alvarez/null-ls.nvim",
	"jose-elias-alvarez/nvim-lsp-ts-utils"
}
