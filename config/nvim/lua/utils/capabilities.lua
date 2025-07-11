local M = {}

function M.with_capabilities(tbl)
	local default_capabilities = vim.lsp.protocol.make_client_capabilities()
	local loaded, cmp = pcall(require, "cmp_nvim_lsp")
	if not loaded then
		return vim.tbl_deep_extend("force", tbl, { capabilities = default_capabilities })
	end

	local cmp_capabilities =
		vim.tbl_deep_extend("force", default_capabilities, cmp.default_capabilities(default_capabilities))
	return vim.tbl_deep_extend("force", tbl, { capabilities = cmp_capabilities })
end

return M
