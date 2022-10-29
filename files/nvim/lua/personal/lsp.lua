local lsp = require("lspconfig")
local coq = require("coq")
require("mason").setup()
require("mason-lspconfig").setup({
  ensure_installed = {"rust_analyzer", "sumneko_lua", "eslint", "tsserver", "ruby_ls", "svelte", "tailwindcss", "gopls"}
})
require("mason-lspconfig").setup_handlers {
  function (server_name)
    lsp[server_name].setup(coq.lsp_ensure_capabilities())
  end,
  ["sumneko_lua"] = function()
    lsp.sumneko_lua.setup {
      settings = {
        Lua = {
          diagnostics = {
            globals = {"vim", "use"}
          },
          workspace = {
            library = vim.api.nvim_get_runtime_file("", true)
          },
          telemetry = {
            enable = false
          },
        }
      }
    }
  end
}

