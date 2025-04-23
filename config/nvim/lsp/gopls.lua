local M = require("utils.capabilities")

return M.with_capabilities({
	cmd = { "gopls" },
	filetypes = { "go", "gomod", "gowork", "gotmpl", "gosum" },
	root_dir = function(bufnr, on_dir)
		local root = vim.fs.root(bufnr, "go.mod")
		if root == nil then
			on_dir(nil)
		else
			local workspace = vim.fs.root(root, "go.work")
			if workspace == nil then
				on_dir(root)
			else
				on_dir(workspace)
			end
		end
	end,
	settings = {
		autoformat = true,
		gopls = {
			analyses = {
				unusedparams = true,
				unusedwrite = true,
				nilness = true,
			},
			gofumpt = true,
			semanticTokens = true,
			staticcheck = true,
		},
	},
})
