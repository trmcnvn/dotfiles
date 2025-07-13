return {
	pack = { src = "https://github.com/stevearc/conform.nvim" },
	config = function()
		require("conform").setup({
			notify_on_error = false,
			default_format_opts = {
				async = true,
				timeout_ms = 2000,
				lsp_format = "fallback",
			},
			formatters_by_ft = {
				lua = { "stylua" },
				javascript = { "prettierd" },
				typescript = { "prettierd" },
				typescriptreact = { "prettierd" },
				svelte = { "prettierd" },
			},
			format_on_save = {
				timeout = 2000,
				lsp_format = "fallback",
			},
		})
		vim.o.formatexpr = "v:lua.require'conform'.formatexpr()"
	end,
}
