return {
  {
    "neovim/nvim-lspconfig",
    event = { "BufReadPost" },
    cmd = { "LspInfo", "LspInstall", "LspUninstall", "Mason" },
    dependencies = {
      "williamboman/mason.nvim",
      "williamboman/mason-lspconfig.nvim",
      "hrsh7th/cmp-nvim-lsp",
      "nvimtools/none-ls.nvim",
      "folke/neodev.nvim",
      { "j-hui/fidget.nvim", tag = "legacy" },
      {
        "pmizio/typescript-tools.nvim",
        dependencies = { "nvim-lua/plenary.nvim" },
      },
      {
        "mrcjkb/rustaceanvim",
        ft = { "rust" },
      },
    },
    config = function()
      local null_ls = require("null-ls")
      local M = require("utils.keymaps")

      require("neodev").setup()
      require("mason").setup({
        ui = {
          border = "rounded",
        },
      })
      require("mason-lspconfig").setup()
      local servers = {
        lua_ls = {
          settings = {
            Lua = {
              workspace = { checkThirdParty = false },
              telemetry = { enabled = false },
            },
          },
        },
        svelte = {
          settings = {
            svelte = {
              plugin = {
                svelte = {
                  format = {
                    enable = false,
                  },
                },
              },
            },
          },
        },
        tailwindcss = {
          filetypes = { "html", "css", "svelte" },
          settings = {
            tailwindCSS = {
              hovers = false,
              codeActions = false,
            },
          },
        },
        ruby_ls = {},
        gopls = {},
        nginx_language_server = {},
      }

      local default_handlers = {
        ["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, { border = "rounded" }),
        ["textDocument/signatureHelp"] = vim.lsp.with(vim.lsp.handlers.signature_help, { border = "rounded" }),
      }

      local capabilities = vim.lsp.protocol.make_client_capabilities()
      local default_capabilities = require("cmp_nvim_lsp").default_capabilities(capabilities)

      local on_attach = function(client, buffer)
        -- Keybinds
        M.n("gh", "<cmd>lua vim.lsp.buf.hover()<cr>")
        M.n("gr", "<cmd>lua vim.lsp.buf.rename()<cr>")
        M.n("df", "<cmd>lua vim.diagnostic.open_float()<cr>")
        M.n("ca", "<cmd>lua vim.lsp.buf.code_action()<cr>")
        vim.api.nvim_buf_create_user_command(buffer, "Format", function(_)
          vim.lsp.buf.format({ bufnr = buffer, timeout_ms = 3000 })
        end, { desc = "LSP: Format current buffer with LSP" })
      end

      for name, config in pairs(servers) do
        require("lspconfig")[name].setup({
          capabilities = default_capabilities,
          filetypes = config.filetypes,
          handlers = vim.tbl_deep_extend("force", {}, default_handlers, config.handlers or {}),
          on_attach = on_attach,
          settings = config.settings,
        })
      end

      local formatting = null_ls.builtins.formatting
      local diagnostics = null_ls.builtins.diagnostics
      local code_actions = null_ls.builtins.code_actions

      null_ls.setup({

        border = "rounded",
        sources = {
          formatting.prettierd.with({
            extra_filetypes = { "svelte" },
          }),
          formatting.stylua,
          diagnostics.eslint_d.with({
            filetypes = { "javascript", "typescript", "svelte" },
            condition = function(utils)
              return utils.root_has_file({ ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json" })
            end,
          }),
          code_actions.eslint_d.with({
            filetypes = { "javascript", "typescript", "svelte" },
            condition = function(utils)
              return utils.root_has_file({ ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json" })
            end,
          }),
        },
      })

      -- Typescript Tools
      require("typescript-tools").setup({
        on_attach = on_attach,
        capabilities = default_capabilities,
        settings = {
          expose_as_code_action = { "add_missing_imports" },
        },
      })

      -- Rust Tools
      vim.g.rustaceanvim = {
        server = {
          on_attach = on_attach,
          capabilities = default_capabilities,
        },
      }

      require("lspconfig.ui.windows").default_options.border = "rounded"

      vim.diagnostic.config({
        float = {
          border = "rounded",
        },
      })
    end,
  },
}
