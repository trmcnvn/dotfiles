local ok, inlay = pcall(require, "inlay-hints")
if not ok then return end

inlay.setup {
	renderer = "inlay-hints/render/eol",
	hints = {
		parameter = {
			show = true,
			highlight = "whitespace"
		},
		type = {
			show = true,
			highlight = "Whitespace"
		}
	},
	only_current_line = false,
	eol = {
		right_align = false,
		right_align_padding = 7,
		parameter = {
			separator = ", ",
			format = function(hints) return string.format(" <- (%s)", hints) end,
		},
		type = {
			separator = ", ",
			format = function(hints) return string.format(" => %s", hints) end,
		}
	}
}

vim.api.nvim_create_autocmd("LspAttach", {
	group = vim.api.nvim_create_augroup("my-inlay-hints", {}),
	callback = function(args)
		local client = vim.lsp.get_client_by_id(args.data.client_id)
		inlay.on_attach(client, args.buf)
	end,
})
