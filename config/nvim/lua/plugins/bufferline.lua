return {
	{
		"akinsho/bufferline.nvim",
		event = "ColorScheme",
		dependencies = {
			"nvim-tree/nvim-web-devicons",
			"rose-pine/neovim",
		},
		keys = {
			{ "<Tab>", "<Cmd>BufferLineCycleNext<CR>", desc = "Next tab" },
			{ "<S-Tab>", "<Cmd>BufferLineCyclePrev<CR>", desc = "Prev tab" },
			-- Deletion is handled by mini.bufremove
		},
		config = function()
			local highlights = require("rose-pine.plugins.bufferline")
			local bufferline = require("bufferline")
			bufferline.setup({
				highlights = vim.tbl_deep_extend("force", highlights, {
					buffer_selected = {
						bold = false,
						italic = false,
					},
				}),
				options = {
					mode = "buffers",
					themable = true,
					style_preset = {
						bufferline.style_preset.no_italic,
						bufferline.style_preset.no_bold,
					},
				},
			})
		end,
	},
}
