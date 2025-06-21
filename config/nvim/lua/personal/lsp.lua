vim.diagnostic.config({
	virtual_text = false,
	virtual_lines = false,
	float = {
		border = "single",
	},
	jump = { float = true },
})

vim.api.nvim_create_autocmd("LspAttach", {
	callback = function(ev)
		local client = vim.lsp.get_client_by_id(ev.data.client_id)
		if client and client:supports_method("textDocument/completion") then
			vim.lsp.completion.enable(true, client.id, ev.buf, { autotrigger = true })
		end
	end,
})

vim.lsp.enable({
	"lua_ls",
	"svelte",
	"tailwindcss",
	"ruby_lsp",
	"gopls",
	"nginx_language_server",
	"zls",
	"vtsls",
	"harper_ls",
})
