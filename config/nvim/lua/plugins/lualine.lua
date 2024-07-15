return {
	{
		"nvim-lualine/lualine.nvim",
		event = "ColorScheme",
		config = function()
			require("lualine").setup({
				options = {
					theme = "auto",
					globalstatus = false,
					component_separators = { left = "", right = "" },
					section_separators = { left = "", right = "" },
				},
				sections = {
					lualine_b = { "branch" },
					lualine_c = {
						{
							"diagnostics",
							sources = { "nvim_diagnostic" },
							sections = { "error", "warn" },
							symbols = { error = " ", warn = " " },
							colored = false,
							always_visible = false,
						},
						{ "filename", path = 1 },
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
							end,
						},
						{ "filetype", icons_enabled = true },
					},
					lualine_y = {
						{ "location", padding = { left = 0, right = 1 } },
					},
					lualine_z = { "progress" },
				},
				extensions = { "lazy", "quickfix" },
			})
		end,
	},
}
