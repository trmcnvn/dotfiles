return {
	{
		"akinsho/bufferline.nvim",
		event = "VeryLazy",
		keys = {
			{ "<Tab>", "<Cmd>BufferLineCycleNext<CR>", desc = "Next buffer" },
			{ "<S-Tab>", "<Cmd>BufferLineCyclePrev<CR>", desc = "Prev buffer" },
		},
		config = function()
			local bufferline = require("bufferline")
			local p = require("rose-pine.palette")
			bufferline.setup({
				highlights = vim.tbl_deep_extend("force", require("rose-pine.plugins.bufferline"), {
					fill = {
						bg = p.base,
					},
					buffer_selected = {
						italic = false,
					},
					close_button_selected = {
						bg = p.surface,
						fg = p.text,
					},
					indicator_selected = {
						bg = p.surface,
					},
				}),
				options = {
					mode = "buffers",
					themable = true,
					name_formatter = function(buf)
						if buf.name == "[No Name]" then
							return "[Untitled]"
						end
						return buf.name
					end,
					get_element_icon = function(element)
						local icon, hl = Snacks.util.icon(element.filetype, "filetype")
						return icon, hl
					end,
				},
			})
		end,
	},
}
