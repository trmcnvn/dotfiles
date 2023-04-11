local ok, lspkind = pcall(require, "lspkind")
if not ok then return end

lspkind.init {
	symbol_map = {
		Copilot = ""
	}
}

local cmp_ok, cmp = pcall(require, "cmp")
if not cmp_ok then return end

local has_words_before = function()
	if vim.api.nvim_buf_get_option(0, "buftype") == "prompt" then return false end
	local line, col = unpack(vim.api.nvim_win_get_cursor(0))
	return col ~= 0 and vim.api.nvim_buf_get_text(0, line - 1, 0, line - 1, col, {})[1]:match("^%s*$") == nil
end

cmp.setup {
	enabled = function()
		local ctx = require("cmp.config.context")
		if vim.api.nvim_get_mode().mode == "c" then
			return true
		else
			return not ctx.in_treesitter_capture("comment") and not ctx.in_syntax_group("Comment")
		end
	end,
	view = {
		entries = { name = "custom", selection_order = "near_cursor" },
	},
	window = {
		completion = cmp.config.window.bordered({
			border = "single",
			winhighlight = "Normal:Pmenu,FloatBorder:Pmenu,CursorLine:PmenuSel,Search:None"
		}),
		documentation = cmp.config.window.bordered({
			border = "single",
			winhighlight = "Normal:Pmenu,FloatBorder:Pmenu,CursorLine:PmenuSel,Search:None"
		})
	},
	snippet = {
		expand = function(args)
			require("luasnip").lsp_expand(args.body)
		end
	},
	mapping = cmp.mapping.preset.insert({
		["<C-e>"] = cmp.mapping.close(),
		["<cr>"] = cmp.mapping.confirm({ behavior = cmp.ConfirmBehavior.Replace, select = false }),
		["<Tab>"] = vim.schedule_wrap(function(fallback)
			if cmp.visible() and has_words_before() then
				cmp.select_next_item({ behavior = cmp.SelectBehavior.Select })
			else
				fallback()
			end
		end)
	}),
	sources = cmp.config.sources({
		{ name = "nvim_lua" },
		{ name = "nvim_lsp" },
		{ name = "luasnip" },
		{ name = "copilot" },
	}, {
		{ name = "path" },
		{ name = "buffer", keyword_length = 5 },
	}),
	formatting = {
		format = lspkind.cmp_format({ mode = "symbol_text", max_width = 50, preset = "default" })
	},
	experimental = {
		ghost_text = true
	}
}
