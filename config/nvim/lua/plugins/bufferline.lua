return {
	pack = { src = "https://github.com/akinsho/bufferline.nvim" },
	config = function()
		local bufferline = require("bufferline")
		bufferline.setup({
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
			options = {
				mode = "buffers",
				themable = true,
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

		local M = require("utils.keymaps")
		M.n("<Tab>", "<Cmd>BufferLineCycleNext<CR>")
		M.n("<S-Tab>", "<Cmd>BufferLineCyclePrev<CR>")
	end,
}
