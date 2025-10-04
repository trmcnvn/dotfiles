return {
	pack = { src = "https://github.com/catppuccin/nvim" },
	config = function()
		require("catppuccin").setup({
			compile_path = vim.fn.stdpath("cache") .. "/catppuccin",
			float = {
				transparent = true,
			},
			show_end_of_buffer = true,
			no_bold = true,
			styles = {
				comments = { "italic" },
				conditionals = {},
			},
			custom_highlights = function(C)
				return {
					MiniTablineCurrent = {
						fg = C.text,
						bg = C.base,
						sp = C.blue,
						style = {},
					},
					MiniTablineFill = { bg = C.base },
					MiniTablineHidden = { fg = C.surface2, bg = C.mantle },
					MiniTablineModifiedCurrent = { fg = C.yellow, bg = C.none, style = {} },
					MiniTablineModifiedHidden = { fg = C.yellow, bg = C.none },
					MiniTablineModifiedVisible = { fg = C.yellow, bg = C.none },
					MiniTablineTabpagesection = { fg = C.surface1, bg = C.base },
					MiniTablineVisible = { bg = C.none },
				}
			end,
			integrations = {
				fidget = true,
				dadbod_ui = true,
			},
		})
		vim.cmd.colorscheme("catppuccin")
	end,
}
