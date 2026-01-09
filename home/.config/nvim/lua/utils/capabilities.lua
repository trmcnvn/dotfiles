local M = {}

function M.with_capabilities(tbl)
	local default_capabilities = vim.lsp.protocol.make_client_capabilities()

	local cmp_capabilities = vim.tbl_deep_extend("force", default_capabilities, MiniCompletion.get_lsp_capabilities())
	return vim.tbl_deep_extend("force", tbl, { capabilities = cmp_capabilities })
end

return M
