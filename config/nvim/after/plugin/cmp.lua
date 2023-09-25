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

local cmp_autopairs_ok, cmp_autopairs = pcall(require, "nvim-autopairs.completion.cmp")
if cmp_autopairs_ok then
	cmp.event:on("confirm_done", cmp_autopairs.on_confirm_done())
end

cmp.setup {
	enabled = function()
		if vim.api.nvim_buf_get_option(0, "buftype") == "prompt" then return false end
		local ctx = require("cmp.config.context")
		if vim.api.nvim_get_mode().mode == "c" then
			return true
		else
			return not ctx.in_treesitter_capture("comment") and not ctx.in_syntax_group("Comment")
		end
	end,
	view = {
		entries = { name = "custom" },
	},
	window = {
		completion = cmp.config.window.bordered({
			border = "rounded",
			winhighlight = "Normal:Pmenu,FloatBorder:Pmenu,CursorLine:PmenuSel,Search:None"
		}),
		documentation = cmp.config.window.bordered({
			max_height = 16,
			max_width = 60,
			border = "rounded",
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
		{ name = "luasnip", keyword_length = 2 },
		{ name = "copilot" },
		{ name = "crates" }
	}, {
		{ name = "path" },
		{ name = "buffer", keyword_length = 3 },
	}),
	sorting = {
		priority_weight = 2,
		comparators = {
			cmp.config.compare.exact,
			require("copilot_cmp.comparators").prioritize,
			cmp.config.compare.offset,
			cmp.config.compare.score,
			cmp.config.compare.recently_used,
			cmp.config.compare.locality,
			cmp.config.compare.kind,
			cmp.config.compare.sort_text,
			cmp.config.compare.length,
			cmp.config.compare.order,
		},
	},
	formatting = {
		fields = { "abbr", "menu", "kind" },
		format = function(entry, item)
			local short_name = {
				nvim_lsp = "LSP",
				nvim_lua = "nvim"
			}
			local menu_name = short_name[entry.source.name] or entry.source.name
			item.menu = string.format("[%s]", menu_name)
			return item
		end,
	},
	experimental = {
		ghost_text = false
	}
}
