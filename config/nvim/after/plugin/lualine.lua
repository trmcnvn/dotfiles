local ok, lualine = pcall(require, "lualine")
if not ok then return end

local sections = {
	lualine_a = { "mode" },
	lualine_b = { "branch" },
	lualine_c = {
		{
			"diagnostics",
			sources = { "nvim_diagnostic" },
			sections = { "error", "warn" },
			symbols = { error = " ", warn = " " },
			colored = false,
			always_visible = true
		}
	},
	lualine_x = {
		{
			"diff",
			colored = false,
			symbols = {
				added = " ",
				modified = " ",
				removed = " ",
			},
			cond = function()
				return vim.fn.winwidth(0) > 80
			end
		},
		{ "filename", path = 1 },
		{ "filetype", icons_enabled = false }
	},
	lualine_y = {
		{ "location", padding = { left = 0, right = 1 } },
	},
	lualine_z = { "progress" }
}

lualine.setup {
	options = {
		theme = "auto",
		globalstatus = true,
		icons_enabled = true,
		component_separators = { left = "", right = "" },
		section_separators = { left = "", right = "" },
		always_divide_middle = true
	},
	sections = sections,
	extensions = { "neo-tree", "lazy", "quickfix" },
}
