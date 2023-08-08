require("catppuccin").setup({
	flavour = "mocha",
	background = { dark = "mocha" },
	transparent_background = true,
	show_end_of_buffer = false,
	term_colors = false,
	no_italic = true,
	no_bold = true,
	no_underline = false,
	integrations = {
		alpha = true,
		barbar = true,
		cmp = true,
		fidget = true,
		treesitter = true,
		treesitter_context = true,
		indent_blankline = { enabled = true, colored_indent_levels = false },
		harpoon = true,
		mason = true,
		neotree = true,
		telescope = { enabled = true },
	},
	native_lsp = {
		enabled = true,
		virtual_text = {
			errors = { "italic" },
			hints = { "italic" },
			warnings = { "italic" },
			information = { "italic" },
		},
		underlines = {
			errors = { "underline" },
			hints = { "underline" },
			warnings = { "underline" },
			information = { "underline" },
		},
		inlay_hints = {
			background = true,
		},
	},
	custom_highlights = function(colors)
		return {}
	end
})

vim.cmd [[colorscheme catppuccin]]
