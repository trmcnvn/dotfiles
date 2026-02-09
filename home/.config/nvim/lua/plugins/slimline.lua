local function jj_info()
	local output = vim.fn.system("nu -c 'jj-prompt | to json'")
	if vim.v.shell_error ~= 0 then
		return nil
	end

	local ok, data = pcall(vim.json.decode, output)
	if not ok then
		return nil
	end

	local bookmark = ""
	if data.bookmarks and #data.bookmarks > 0 then
		bookmark = data.bookmarks[1].name or ""
	end

	return {
		change_id = data.change_id or "",
		bookmark = bookmark,
	}
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
