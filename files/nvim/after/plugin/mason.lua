local status, mason = pcall(require, "mason")
if (not status) then return end
local status2, lspconfig = pcall(require, "mason-lspconfig")
if (not status2) then return end

local augroup_format = vim.api.nvim_create_augroup("format", { clear = true })
local augroup_diagnostic = vim.api.nvim_create_augroup("diagnostic", { clear = true })
local on_attach = function(_, bufnr)
  vim.api.nvim_clear_autocmds({ group = augroup_format, buffer = bufnr })
  vim.api.nvim_create_autocmd("BufWritePre", {
    group = augroup_format,
    buffer = bufnr,
    callback = function()
      vim.lsp.buf.format({ bufnr = bufnr })
    end,
  })
end

local capabilities = require("cmp_nvim_lsp").default_capabilities()

local protocol = require("vim.lsp.protocol")
protocol.CompletionItemKind = {
  '', -- Text
  '', -- Method
  '', -- Function
  '', -- Constructor
  '', -- Field
  '', -- Variable
  '', -- Class
  'ﰮ', -- Interface
  '', -- Module
  '', -- Property
  '', -- Unit
  '', -- Value
  '', -- Enum
  '', -- Keyword
  '﬌', -- Snippet
  '', -- Color
  '', -- File
  '', -- Reference
  '', -- Folder
  '', -- EnumMember
  '', -- Constant
  '', -- Struct
  '', -- Event
  'ﬦ', -- Operator
  '', -- TypeParameter
}

mason.setup({})
lspconfig.setup({
  ensure_installed = {
    "rust_analyzer",
    "sumneko_lua",
    "eslint",
    "tsserver",
    "ruby_ls",
    "svelte",
    "tailwindcss",
    "gopls"
  },
  automatic_installation = true
})
lspconfig.setup_handlers {
  function(server_name)
    require("lspconfig")[server_name].setup({
      on_attach = on_attach,
      capabilities = capabilities,
    })
  end,
  ["sumneko_lua"] = function()
    require("lspconfig")["sumneko_lua"].setup({
      on_attach = on_attach,
      capabilities = capabilities,
      settings = {
        Lua = {
          runtime = {
            version = "LuaJIT",
            path = vim.split(package.path, ";")
          },
          diagnostics = {
            globals = { "vim" },
          },
          workspace = {
            library = vim.api.nvim_get_runtime_file("", true),
            checkThirdParty = false
          },
          telemetry = {
            enable = false,
          },
        },
      },
    })
  end,
  ["tsserver"] = function()
    require("lspconfig")["tsserver"].setup({
      on_attach = on_attach,
      capabilities = capabilities,
      cmd = { "typescript-language-server", "--stdio" }
    })
  end,
  ["ruby_ls"] = function()
    require("lspconfig")["ruby_ls"].setup({
      on_attach = function(client, bufnr)
        on_attach(client, bufnr)
        vim.api.nvim_clear_autocmds({ group = augroup_diagnostic, buffer = bufnr })
        vim.api.nvim_create_autocmd({ "BufEnter", "BufWritePre", "CursorHold" }, {
          group = augroup_diagnostic,
          buffer = bufnr,
          callback = function()
            local params = vim.lsp.util.make_text_document_params(bufnr)
            client.request(
              "textDocument/diagnostic",
              { textDocument = params },
              function(err, result)
                if err then return end
                vim.lsp.diagnostic.on_publish_diagnostics(
                  nil,
                  vim.tbl_extend("keep", params, { diagnostics = result.items }),
                  { bufnr = bufnr, client_id = client.id }
                )
              end
            )
          end
        })
      end,
      capabilities = capabilities,
      cmd = { "bundle", "exec", "ruby-lsp" },
      filetypes = { "ruby", "rakefile", "rspec" },
      init_options = {
        enabledFeatures = {
          "documentHighlights",
          "documentSymbols",
          "formatting",
          "diagnostics",
          "codeActions",
          "inlayHint",
          "hover",
          "documentLink",
          "foldingRanges",
          "selectionRanges",
          "semanticHighlighting"
        },
      },
      root_dir = require("lspconfig").util.root_pattern("Gemfile")
    })
  end
}

vim.lsp.handlers["textDocument/publishDiagnostics"] = vim.lsp.with(
  vim.lsp.diagnostic.on_publish_diagnostics, {
  underline = true,
  update_in_insert = false,
  virtual_text = { spacing = 4, prefix = "●" },
  -- virtual_text = false,
  severity_sort = true,
}
)

-- Diagnostic symbols in the sign column (gutter)
local signs = { Error = " ", Warn = " ", Hint = " ", Info = " " }
for type, icon in pairs(signs) do
  local hl = "DiagnosticSign" .. type
  vim.fn.sign_define(hl, { text = icon, texthl = hl, numhl = hl })
end

vim.diagnostic.config({
  virtual_text = {
    prefix = "",
  },
  -- virtual_text = false,
  sverity_sort = true,
  update_in_insert = true,
  float = {
    source = "always"
  },
})

local M = require("utils.keymaps")
M.n("<leader>gh", "<cmd>lua vim.lsp.buf.hover()<CR>")
M.n("<leader>gR", "<cmd>lua vim.lsp.buf.rename()<CR>")