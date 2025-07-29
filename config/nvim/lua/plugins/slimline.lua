-- Cache to avoid frequent system calls
local jj_cache = {
	value = nil,
	last_update = 0,
	update_interval = 120,
}

local function jj_info()
	local current_time = os.time()

	-- Return cached value if not expired
	if jj_cache.value and (current_time - jj_cache.last_update < jj_cache.update_interval) then
		return jj_cache.value
	end

	-- Execute the jj command
	local output = vim.fn.system(
		string.format(
			[[jj log --revisions @ --no-graph --ignore-working-copy --color=never --limit 1 --template "%s"]],
			"change_id.shortest(6)"
		)
	)

	local closest_bookmark =
		vim.fn.system("jj log -r 'heads(::@- & bookmarks())' --no-graph --color=never --limit=1 --template 'bookmarks'")

	-- Handle errors and cleanup
	if vim.v.shell_error ~= 0 then
		jj_cache.value = {}
	else
		jj_cache.value = { change_id = output:gsub("\n$", ""), bookmark = closest_bookmark:gsub("\n$", "") }
	end
	jj_cache.last_update = current_time

	return jj_cache.value
end

return {
	pack = { src = "https://github.com/sschleemilch/slimline.nvim" },
	config = function()
		require("slimline").setup({
			bold = true,
			style = "fg",
			components = {
				left = {
					"mode",
					"path",
					function(active)
						local slimline = require("slimline")
						local jj = jj_info()
						if not jj then
							return ""
						end

						local icons = slimline.config.configs["git"].icons
						local change_id = string.format("%s %s", icons.branch, jj.change_id or "not a jj repo")

						return slimline.highlights.hl_component(
							{ primary = change_id, secondary = jj.bookmark or "" },
							slimline.highlights.hls.components["filetype_lsp"],
							slimline.get_sep("filetype_lsp"),
							"right",
							active
						)
					end,
				},
				center = { "recording" },
				right = { "diagnostics", "filetype_lsp", "progress" },
			},
		})
	end,
}
