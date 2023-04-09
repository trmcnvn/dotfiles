local status, cmp = pcall(require, "cmp")
if (not status) then return end

local lspkind_status, lspkind = pcall(require, "lspkind")
if (not lspkind_status) then return end

local has_words_before = function()
  if vim.api.nvim_buf_get_option(0, "buftype") == "prompt" then return false end
  local line, col = unpack(vim.api.nvim_win_get_cursor(0))
  return col ~= 0 and vim.api.nvim_buf_get_text(0, line - 1, 0, line - 1, col, {})[1]:match("^%s*$") == nil
end

cmp.setup({
  view = {
    entries = { name = "custom", selection_order = "near_cursor" }
  },
  snippet = {
    expand = function(args)
      require("luasnip").lsp_expand(args.body)
    end,
  },
  mapping = cmp.mapping.preset.insert({
    ["<C-e>"] = cmp.mapping.close(),
    ["<CR>"] = cmp.mapping.confirm({
      behavior = cmp.ConfirmBehavior.Replace,
      select = false,
    }),
    ["<Tab>"] = vim.schedule_wrap(function(fallback)
      if cmp.visible() and has_words_before() then
        cmp.select_next_item({ behavior = cmp.SelectBehavior.Select })
      else
        fallback()
      end
    end)
  }),
  sources = cmp.config.sources({
    { name = "copilot" },
    { name = "nvim_lua" },
    { name = "nvim_lsp" },
    { name = "luasnip" },
  }),
  sorting = {
    priority_weight = 2,
    comparator = {
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
    format = lspkind.cmp_format({ mode = "symbol_text", maxwidth = 50, preset = "default", symbol_map = { Copilot = "" } }),
  },
  experimental = {
    ghost_text = false,
  }
})
