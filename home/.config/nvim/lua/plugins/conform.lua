return {
	pack = { src = "https://github.com/stevearc/conform.nvim" },
	config = function()
		vim.api.nvim_create_user_command("ConformDisable", function()
			vim.g.disable_autoformat = true
		end, { desc = "Disable conform-autoformat-on-save" })

		vim.api.nvim_create_user_command("ConformEnable", function()
			vim.g.disable_autoformat = false
		end, { desc = "Re-enable confirm-autoformat-on-save" })

		require("conform").setup({
			notify_on_error = false,
			default_format_opts = {
				async = true,
				timeout_ms = 2000,
				lsp_format = "fallback",
			},
			format_after_save = function(bufnr)
				if vim.g.disable_autoformat then
					return
				end
				return {
					async = true,
					timeout_ms = 2000,
					lsp_format = "fallback",
				}
			end,
			formatters_by_ft = {
				lua = { "stylua" },
				javascript = { "oxfmt", "biome", "prettierd", stop_after_first = true },
				typescript = { "oxfmt", "biome", "prettierd", stop_after_first = true },
				typescriptreact = { "oxfmt", "biome", "prettierd", stop_after_first = true },
				svelte = { "oxfmt", "prettierd", stop_after_first = true },
			},
			formatters = {
				oxfmt = {
					condition = function(_, ctx)
						return vim.fs.find({ ".oxfmtrc.json", ".oxfmtrc.jsonc" }, {
							path = ctx.filename,
							upward = true,
							stop = vim.uv.os_homedir(),
						})[1] ~= nil
					end,
				},
				biome = {
					condition = function(_, ctx)
						return vim.fs.find({ "biome.json", "biome.jsonc" }, {
							path = ctx.filename,
							upward = true,
							stop = vim.uv.os_homedir(),
						})[1] ~= nil
					end,
				},
				prettierd = {
					condition = function(_, ctx)
						return vim.fs.find({
							".prettierrc",
							".prettierrc.json",
							".prettierrc.js",
							".prettierrc.cjs",
							".prettierrc.mjs",
							"prettier.config.js",
							"prettier.config.cjs",
							"prettier.config.mjs",
						}, {
							path = ctx.filename,
							upward = true,
							stop = vim.uv.os_homedir(),
						})[1] ~= nil
					end,
				},
			},
		})
		vim.o.formatexpr = "v:lua.require'conform'.formatexpr()"
	end,
}
