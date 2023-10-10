return {
	"nvim-lua/plenary.nvim",
	"tpope/vim-sleuth",
	-- Sessions
	{ "folke/persistence.nvim", event = "BufReadPre" },
	-- Quickfix
	"romainl/vim-qf",
	-- Autopairing
	{ "windwp/nvim-autopairs",  event = "InsertEnter" },
	"windwp/nvim-ts-autotag",
	-- Rust Crates
	{
		"Saecki/crates.nvim",
		tag = "v0.3.0",
		dependencies = { "nvim-lua/plenary.nvim" },
		config = function()
			require("crates").setup()
			vim.api.nvim_create_autocmd("BufRead Cargo.toml", {
				command = "lua require('crates').show()"
			})
		end
	},
	-- Bottom bar
	{ "nvim-lualine/lualine.nvim", event = "VeryLazy" }
}
