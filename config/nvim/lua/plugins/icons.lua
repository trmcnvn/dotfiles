return {
	{
		"echasnovski/mini.icons",
		lazy = true,
		opts = {
			file = {
				[".gitkeep"] = { glyph = "󰊢", hl = "MiniIconsGrey" },
				[".keep"] = { glyph = "󰊢", hl = "MiniIconsGrey" },
			},
			filetype = {
				dotenv = { glyph = "", hl = "MiniIconsYellow" },
			},
		},
		config = function()
			require("mini.icons").setup()
			MiniIcons.mock_nvim_web_devicons()
			MiniIcons.tweak_lsp_kind()
		end,
	},
}
