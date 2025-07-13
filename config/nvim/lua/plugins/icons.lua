return {
	pack = { src = "https://github.com/echasnovski/mini.icons" },
	config = function()
		require("mini.icons").setup({
			file = {
				[".gitkeep"] = { glyph = "󰊢", hl = "MiniIconsGrey" },
				[".keep"] = { glyph = "󰊢", hl = "MiniIconsGrey" },
			},
			filetype = {
				dotenv = { glyph = "", hl = "MiniIconsYellow" },
			},
		})
		MiniIcons.mock_nvim_web_devicons()
		MiniIcons.tweak_lsp_kind()
	end,
}
