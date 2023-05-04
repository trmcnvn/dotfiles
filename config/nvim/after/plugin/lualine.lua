local ok, lualine = pcall(require, "lualine")
if not ok then return end

local theme = require("lualine.themes.rose-pine")
local palette = require("rose-pine.palette")
theme.normal.c.bg = "none"
theme.insert.c.bg = "none"
theme.visual.c.bg = "none"
theme.replace.c.bg = "none"
theme.command.c.bg = "none"
theme.inactive = {
	a = { bg = palette.rose, fg = palette.base, gui = "bold" },
	b = { bg = palette.overlay, fg = palette.rose },
	c = { bg = "none", fg = palette.subtle }
}

local sections = {
	lualine_a = { "mode" },
	lualine_b = { "branch" },
	lualine_c = {
		{
			"buffers",
			symbols = { modified = " [~]", alternate_file = "", directory = "" },
			max_length = vim.o.columns * 2 / 3
		}
	},
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
		theme = theme,
		icons_enabled = true,
		section_separators = { left = "", right = "" },
		component_separators = { left = "", right = "" },
		disabled_filetypes = { statusline = { "dashboard" } },
	},
	sections = sections,
	extensions = { "neo-tree", "lazy", "quickfix" },
}
