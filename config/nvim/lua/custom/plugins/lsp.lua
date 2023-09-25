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
				-- "typescript-language-server",
				-- "rust-analyzer",
				"lua-language-server",
				"solargraph",
				"svelte-language-server",
				"tailwindcss-language-server",
				"gopls",
				"prisma-language-server",
				"nginx-language-server",
				"efm"
			}
		}
	},
	"simrat39/inlay-hints.nvim",
	{ "j-hui/fidget.nvim", tag = "legacy", opts = { window = { blend = 0 } } },
	"folke/neodev.nvim",
	{
		"pmizio/typescript-tools.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"neovim/nvim-lspconfig"
		},
	},
	{
		"simrat39/rust-tools.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"neovim/nvim-lspconfig"
		},
	},
	"creativenull/efmls-configs-nvim"
}
