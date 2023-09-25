local ok, lualine = pcall(require, "lualine")
if not ok then return end

local sections = {
	lualine_a = { "mode" },
	lualine_b = { "branch" },
	lualine_c = { { "filename", path = 0 } },
	lualine_x = {
		{
			"diff",
			symbols = {
				added = "+",
				modified = "~",
				removed = "-",
			}
		},
		{ "encoding" },
		{ "fileformat" },
		{ "filetype" }
	},
	lualine_y = {
		{ "progress", padding = { left = 1, right = 1 } },
	},
	lualine_z = {
		{ "location", padding = { left = 0, right = 1 } }
	}
}

lualine.setup {
	options = {
		theme = "auto",
		icons_enabled = true,
		component_separators = { left = '', right = '' },
		section_separators = { left = '', right = '' },
		disabled_filetypes = { statusline = { "dashboard" } },
	},
	sections = sections,
	extensions = { "neo-tree", "lazy", "quickfix" },
}
