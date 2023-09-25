require("catppuccin").setup({
	flavour = "mocha",
	background = { dark = "mocha" },
	transparent_background = false,
	show_end_of_buffer = true,
	term_colors = false,
	dim_inactive = {
		enabled = false,
		shade = "dark",
		percentage = 0.15
	},
	no_italic = false,
	no_bold = false,
	no_underline = false,
	styles = {
		comments = { "italic" }
	},
	integrations = {
		-- barbar = true,
		cmp = true,
		-- dashboard = true,
		fidget = true,
		treesitter = true,
		treesitter_context = true,
		-- indent_blankline = { enabled = false, colored_indent_levels = false },
		harpoon = true,
		mason = true,
		neotree = true,
		telescope = { enabled = true },
		native_lsp = {
			enabled = true,
			virtual_text = {
				errors = { "italic" },
				hints = { "italic" },
				warnings = { "italic" },
				information = { "italic" },
			},
			underlines = {
				errors = { "undercurl" },
				hints = { "undercurl" },
				warnings = { "undercurl" },
				information = { "undercurl" },
			},
			inlay_hints = {
				background = true,
			},
		},
	},
	color_overrides = {
		all = {
			base = "#191724"
		}
	},
	custom_highlights = function(colors)
		return {}
	end
})

vim.cmd [[colorscheme catppuccin]]
