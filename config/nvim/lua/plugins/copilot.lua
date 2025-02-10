return {
	{
		"zbirenbaum/copilot.lua",
		event = { "BufNewFile" },
		config = function()
			require("copilot").setup({
				panel = { enabled = false },
				suggestion = { auto_trigger = true },
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
			provider = "claude",
			auto_suggestions_provider = "claude",
			claude = {
				api_key_name = "cmd:bw get notes ANTHROPIC_API_KEY",
			},
			behaviour = {
				auto_suggestions = false,
			},
			hints = { enabled = false },
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
