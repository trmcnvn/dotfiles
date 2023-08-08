local ok, lualine = pcall(require, "lualine")
if not ok then return end

local sections = {
	lualine_a = { "mode" },
	lualine_b = { "branch" },
	lualine_c = { { "filename", path = 1 } },
	lualine_x = {
		{ require("lazy.status").updates, cond = require("lazy.status").has_updates },
		{
			"diff",
			symbols = {
				added = "+",
				modified = "~",
				removed = "-",
			}
		},
	},
	lualine_y = {
		{ "progress", separator = " ",                  padding = { left = 1, right = 0 } },
		{ "location", padding = { left = 0, right = 1 } }
	},
	lualine_z = {
		{ "datetime", style = "%H:%M" }
	}
}

lualine.setup {
	options = {
		theme = "catppuccin",
		icons_enabled = true,
		section_separators = { left = "", right = "" },
		component_separators = { left = "", right = "" },
		disabled_filetypes = { statusline = { "dashboard" } },
	},
	sections = sections,
	extensions = { "neo-tree", "lazy", "quickfix" },
}
