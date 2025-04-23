local iswin = vim.uv.os_uname().version:match("Windows")
local M = require("utils.capabilities")

local function insert_package_json(config_files, field, fname)
	local path = vim.fn.fnamemodify(fname, ":h")
	local root_with_package = vim.fs.dirname(vim.fs.find("package.json", { path = path, upward = true })[1])

	if root_with_package then
		-- only add package.json if it contains field parameter
		local path_sep = iswin and "\\" or "/"
		for line in io.lines(root_with_package .. path_sep .. "package.json") do
			if line:find(field) then
				config_files[#config_files + 1] = "package.json"
				break
			end
		end
	end
	return config_files
end

return M.with_capabilities({
	cmd = { "tailwindcss-language-server", "--stdio" },
	filetypes = { "html", "css", "svelte" },
	settings = {
		tailwindCSS = {
			classAttributes = { "class", "className", "class:list", "classList", "ngClass" },
			includeLanguages = {
				eelixir = "html-eex",
				eruby = "erb",
				htmlangular = "html",
				templ = "html",
			},
			lint = {
				cssConflict = "warning",
				invalidApply = "error",
				invalidConfigPath = "error",
				invalidScreen = "error",
				invalidTailwindDirective = "error",
				invalidVariant = "error",
				recommendedVariantOrder = "warning",
			},
			validate = true,
		},
	},
	before_init = function(_, config)
		if not config.settings then
			config.settings = {}
		end
		if not config.settings.editor then
			config.settings.editor = {}
		end
		if not config.settings.editor.tabSize then
			config.settings.editor.tabSize = vim.lsp.util.get_effective_tabstop()
		end
	end,
	root_dir = function(bufnr, on_dir)
		local root_files = {
			"tailwind.config.js",
			"tailwind.config.cjs",
			"tailwind.config.mjs",
			"tailwind.config.ts",
			"postcss.config.js",
			"postcss.config.cjs",
			"postcss.config.mjs",
			"postcss.config.ts",
		}
		local fname = vim.api.nvim_buf_get_name(bufnr)
		root_files = insert_package_json(root_files, "tailwindcss", fname)
		on_dir(vim.fs.dirname(vim.fs.find(root_files, { path = fname, upward = true })[1]))
	end,
})
