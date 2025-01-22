return {
	{
		"akinsho/bufferline.nvim",
		event = "ColorScheme",
		keys = {
			{ "<Tab>", "<Cmd>BufferLineCycleNext<CR>", desc = "Next buffer" },
			{ "<S-Tab>", "<Cmd>BufferLineCyclePrev<CR>", desc = "Prev buffer" },
			-- Deletion is handled by mini.bufremove
		},
		config = function()
			local bufferline = require("bufferline")
			bufferline.setup({
				options = {
					mode = "buffers",
					themable = true,
					style_preset = {
						bufferline.style_preset.no_italic,
						bufferline.style_preset.no_bold,
					},
					name_formatter = function(buf)
						if buf.name == "[No Name]" then
							return "[Untitled]"
						end
						return buf.name
					end,
					get_element_icon = function(element)
						local icon, hl = MiniIcons.get("filetype", element.filetype)
						return icon, hl
					end,
				},
			})
		end,
	},
}
