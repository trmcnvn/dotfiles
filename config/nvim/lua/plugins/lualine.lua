return {
	{
		"nvim-lualine/lualine.nvim",
		event = "VeryLazy",
		-- dependencies = { "SmiteshP/nvim-navic" },
		init = function()
			-- Hide the statusline until lualine is loaded
			vim.g.lualine_laststatus = vim.o.laststatus
			if vim.fn.argc(-1) > 0 then
				vim.o.statusline = " "
			else
				vim.o.laststatus = 0
			end
		end,
		config = function()
			vim.o.laststatus = vim.g.lualine_laststatus
			require("lualine").setup({
				options = {
					theme = "rose-pine",
					globalstatus = true,
					component_separators = "", --{ left = "", right = "" },
					section_separators = { left = "", right = "" }, --{ left = "", right = "" },
					disabled_filetypes = { statusline = { "ministarter" }, winbar = {} },
					ignore_focus = {},
					always_divide_middle = true,
					refresh = {
						statusline = 100,
						tabline = 1000,
						winbar = 1000,
					},
				},
				sections = {
					lualine_a = {
						{
							"mode",
							seperator = { left = "" },
							right_padding = 2,
						},
					},
					lualine_b = {
						"branch",
						{ "filename", path = 1 },
						{
							"diff",
							source = function()
								local gitsigns = vim.b.gitsigns_status_dict
								if gitsigns then
									return {
										added = gitsigns.added,
										modified = gitsigns.changed,
										removed = gitsigns.removed,
									}
								end
								local minidiff = vim.b.minidiff_summary
								if minidiff then
									return {
										added = minidiff.add,
										modified = minidiff.change,
										removed = minidiff.delete,
									}
								end
							end,
						},
					},
					lualine_c = {},
					-- {
					-- 	function()
					-- 		return require("nvim-navic").get_location()
					-- 	end,
					-- 	cond = function()
					-- 		return package.loaded["nvim-navic"] and require("nvim-navic").is_available()
					-- 	end,
					-- },
					lualine_x = {},
					lualine_y = { "os.date('%a %b %d %H:%M')" },
					lualine_z = { { "location", seperator = { right = "" }, left_padding = 2 } },
				},
				inactive_sections = {
					lualine_a = { { "filename", path = 1 } },
					lualine_b = {},
					lualine_c = {},
					lualine_x = {},
					lualine_y = {},
					lualine_z = { "location" },
				},
				tabline = {},
				winbar = {},
				inactive_winbar = {},
				extensions = {},
			})
		end,
	},
}
