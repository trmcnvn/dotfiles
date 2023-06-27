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
				"typescript-language-server",
				"rust-analyzer",
				"lua-language-server",
				"solargraph",
				"svelte-language-server",
				"tailwindcss-language-server",
				"gopls",
				"prisma-language-server",
				"nginx-language-server"
			}
		}
	},
	"simrat39/inlay-hints.nvim",
	{ "j-hui/fidget.nvim", tag = "legacy" },
	"folke/neodev.nvim",
	"jose-elias-alvarez/null-ls.nvim",
}
