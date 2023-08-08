return {
	"nvim-lua/plenary.nvim",
	"tpope/vim-sleuth",
	"ThePrimeagen/harpoon",
	"folke/zen-mode.nvim",
	"echasnovski/mini.ai",
	{ "folke/persistence.nvim",   event = "BufReadPre" },
	{ "luukvbaal/statuscol.nvim", opts = { setopt = true } },
	"romainl/vim-qf",
	"windwp/nvim-autopairs",
	"windwp/nvim-ts-autotag",
	"Saecki/crates.nvim",
	{ "lukas-reineke/indent-blankline.nvim", opts = { show_current_context = false, show_current_context_start = false } },
	{ "nvim-lualine/lualine.nvim",           event = "VeryLazy" }
	-- "tjdevries/express_line.nvim",
}
