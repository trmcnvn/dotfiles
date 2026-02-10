local jj_cache = {
	value = nil,
	last_update = 0,
	update_interval = 30,
}

local function jj_info()
	local current_time = os.time()
	if jj_cache.value and (current_time - jj_cache.last_update < jj_cache.update_interval) then
		return jj_cache.value
	end

	local output = vim.fn.system("nu -c 'jj-prompt | to json'")
	if vim.v.shell_error ~= 0 then
		jj_cache.value = nil
		jj_cache.last_update = current_time
		return nil
	end

	local ok, data = pcall(vim.json.decode, output)
	if not ok or data == vim.NIL then
		jj_cache.value = nil
		jj_cache.last_update = current_time
		return nil
	end

	local bookmark = ""
	if data.bookmarks and #data.bookmarks > 0 then
		bookmark = data.bookmarks[1].name or ""
	end

	jj_cache.value = {
		change_id = data.change_id or "",
		bookmark = bookmark,
	}
	jj_cache.last_update = current_time
	return jj_cache.value
end

return {
	pack = { src = "https://github.com/sschleemilch/slimline.nvim" },
	config = function()
		require("slimline").setup({
			bold = true,
			style = "fg",
			configs = {
				mode = { verbose = true },
			},
			spaces = {
				components = "",
				left = "",
				right = "",
			},
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
						local change_id = string.format("%s %s", icons.branch, jj.change_id)

						return slimline.highlights.hl_component(
							{ primary = change_id, secondary = jj.bookmark },
							slimline.highlights.hls.components["filetype_lsp"],
							slimline.get_sep("filetype_lsp"),
							"right",
							active
						)
					end,
				},
				center = {},
				right = { "filetype_lsp", "progress" },
			},
		})
	end,
}
