-- Cache to avoid frequent system calls
local jj_cache = {
	value = nil,
	last_update = 0,
	update_interval = 120,
}

local function jj_revision()
	local current_time = os.time()

	-- Return cached value if not expired
	if jj_cache.value and (current_time - jj_cache.last_update < jj_cache.update_interval) then
		return jj_cache.value
	end

	-- Execute the jj command
	local output = vim.fn.system(
		string.format(
			[[jj log --revisions @ --no-graph --ignore-working-copy --color=never --limit 1 --template "%s"]],
			"separate(' ', change_id.shortest(4), bookmarks)"
		)
	)

	-- Handle errors and cleanup
	if vim.v.shell_error ~= 0 then
		jj_cache.value = "jj error"
	else
		jj_cache.value = "@" .. output:gsub("\n$", "")
	end
	jj_cache.last_update = current_time

	return jj_cache.value
end

return {
	{
		"nvim-lualine/lualine.nvim",
		event = "VeryLazy",
		init = function()
			-- Hide statusline until lualine loads
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
					component_separators = "",
					section_separators = { left = "█", right = "█" },
					disabled_filetypes = { statusline = { "ministarter" }, winbar = {} },
					ignore_focus = {},
					always_divide_middle = true,
					refresh = {
						statusline = 100, -- Fast refresh for statusline
						tabline = 1000,
						winbar = 1000,
					},
				},
				sections = {
					lualine_a = {
						{ "mode" },
					},
					lualine_b = {
						{
							jj_revision,
							icon = "",
							cond = function()
								return vim.fn.executable("jj") == 1
							end,
						},
						{ "filename", path = 1 }, -- Show relative path
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
					lualine_x = {},
					lualine_y = { "os.date('%a %b %d %H:%M')" },
					lualine_z = { { "location" } },
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
