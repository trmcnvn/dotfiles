return {
  pack = { src = "https://github.com/saadparwaiz1/cmp_luasnip" },
  config = function()
    require("luasnip.loaders.from_vscode").lazy_load()
  end
}
