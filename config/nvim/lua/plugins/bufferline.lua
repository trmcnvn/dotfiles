return {
	{
		"akinsho/bufferline.nvim",
		event = "Colorscheme",
		keys = {
			{ "<Tab>", "<Cmd>BufferLineCycleNext<CR>", desc = "Next buffer" },
			{ "<S-Tab>", "<Cmd>BufferLineCyclePrev<CR>", desc = "Prev buffer" },
		},
		config = function()
			local bufferline = require("bufferline")
			-- local p = require("rose-pine.palette")

			bufferline.setup({
				-- Custom highlights with rose-pine integration
				-- highlights = vim.tbl_deep_extend("force", require("rose-pine.plugins.bufferline"), {
				-- 	fill = { bg = "none" },
				-- 	buffer_selected = { italic = false },
				-- 	close_button_selected = { bg = p.surface, fg = p.text },
				-- 	indicator_selected = { bg = p.surface },
				-- }),
				highlights = {
					fill = { bg = { attribute = "bg", highlight = "Normal" } },
					buffer_selected = { italic = false },
					diagnostic_selected = { italic = false },
					hint_selected = { italic = false },
					hint_diagnostic_selected = { italic = false },
					info_selected = { italic = false },
					info_diagnostic_selected = { italic = false },
					warning_selected = { italic = false },
					warning_diagnostic_selected = { italic = false },
					error_selected = { italic = false },
					error_diagnostic_selected = { italic = false },
					duplicate_selected = { italic = false },
					duplicate_visible = { italic = false },
					pick_selected = { italic = false },
					pick_visible = { italic = false },
					pick = { italic = false },
				},

				-- Bufferline behavior and appearance
				options = {
					mode = "buffers",
					themable = true,
					name_formatter = function(buf) -- Rename [No Name] buffers
						if buf.name == "[No Name]" then
							return "[Untitled]"
						end
						return buf.name
					end,
					get_element_icon = function(element)
						if Snacks then
							local icon, hl = Snacks.util.icon(element.filetype, "filetype")
							return icon or "?", hl or "BufferLineBuffer"
						end
						return "?", "BufferLineBuffer"
					end,
					show_buffer_close_icons = false,
					show_close_icon = false,
					always_show_bufferline = true,
					diagnostics = "nvim_lsp",
					close_command = function(n)
						Snacks.bufdelete(n)
					end,
					right_mouse_command = function(n)
						Snacks.bufdelete(n)
					end,
				},
			})
		end,
	},
}
