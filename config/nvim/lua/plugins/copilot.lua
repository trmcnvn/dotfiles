return {
	{
		"zbirenbaum/copilot.lua",
		event = { "BufNewFile" },
		commit = "825b6a9574584c5f90a4abcdf04ebb98f2c1260a",
		config = function()
			require("copilot").setup({
				panel = { enabled = false },
				suggestion = { auto_trigger = true },
				copilot_model = "gpt-4o-copilot",
			})
		end,
	},
	{
		"yetone/avante.nvim",
		lazy = true,
		version = false,
		build = "make",
		keys = {
			{ "<leader>aa", "<cmd>AvanteToggle<CR>" },
		},
		opts = {
			provider = "copilot",
			auto_suggestions_provider = "copilot",
			copilot = {
				model = "claude-3.7-sonnet",
			},
			behaviour = {
				auto_suggestions = false,
			},
			hints = { enabled = false },
			windows = {
				width = 40,
				wrap = true,
			},
			file_selector = {
				provider = "snacks",
				provider_opts = {},
			},
		},
		dependencies = {
			"nvim-treesitter/nvim-treesitter",
			"stevearc/dressing.nvim",
			"nvim-lua/plenary.nvim",
			"MunifTanjim/nui.nvim",
			"echasnovski/mini.icons",
			{
				"MeanderingProgrammer/render-markdown.nvim",
				opts = {
					file_types = { "markdown", "Avante" },
				},
				ft = { "markdown", "Avante" },
				latex = { enabled = false },
			},
		},
	},
}
