local status, cmp = pcall(require, "cmp")
if (not status) then return end

local lspkind_status, lspkind = pcall(require, "lspkind")
if (not lspkind_status) then return end

cmp.setup({
  snippet = {
    expand = function(args)
      require("luasnip").lsp_expand(args.body)
    end,
  },
  mapping = cmp.mapping.preset.insert({
    ["<C-e>"] = cmp.mapping.close(),
    ["<CR>"] = cmp.mapping.confirm({
      behavior = cmp.ConfirmBehavior.Replace,
      select = true,
    }),
  }),
  sources = cmp.config.sources({
    { name = "nvim_lua" },
    { name = "nvim_lsp" },
    { name = "luasnip" },
    { name = "copilot" },
  }),
  formatting = {
    format = lspkind.cmp_format({ mode = "symbol_text", maxwidth = 50, preset = "default", symbol_map = { Copilot = "" } }),
  },
  experimental = {
    native_menu = false,
    ghost_text = false,
  }
})
