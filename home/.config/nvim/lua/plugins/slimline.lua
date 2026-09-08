local jj_cache = {
	value = nil,
	last_update = 0,
	update_interval = 30,
	pending = false,
}

local function refresh_jj_info()
	jj_cache.pending = true

	vim.system({ "nu", "-c", "jj-prompt | to json" }, { text = true, timeout = 5000 }, function(result)
		vim.schedule(function()
			jj_cache.pending = false
			jj_cache.last_update = os.time()

			local ok, data = pcall(vim.json.decode, result.stdout or "")
			if result.code ~= 0 or not ok then
				jj_cache.value = nil
			elseif data == vim.NIL then
				jj_cache.value = { change_id = "", bookmark = "" }
			else
				local bookmark = ""
				if data.bookmarks and #data.bookmarks > 0 then
					bookmark = data.bookmarks[1].name or ""
				end

				jj_cache.value = {
					change_id = data.change_id or "",
					bookmark = bookmark,
				}
			end

			vim.cmd.redrawstatus()
		end)
	end)
end

local function jj_info()
	local cache_expired = os.time() - jj_cache.last_update >= jj_cache.update_interval
	if cache_expired and not jj_cache.pending then
		refresh_jj_info()
	end

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
