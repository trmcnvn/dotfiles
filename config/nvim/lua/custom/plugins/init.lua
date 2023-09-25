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
		dependencies = { "nvim-lua/plenary.nvim" }
	},
	-- Bottom bar
	{ "nvim-lualine/lualine.nvim", event = "VeryLazy" }
}
