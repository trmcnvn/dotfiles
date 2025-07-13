return {
  pack = { src = "https://github.com/mason-org/mason.nvim" },
  config = function()
    require("mason").setup()
    require("mason-lspconfig").setup()
  end,
}
