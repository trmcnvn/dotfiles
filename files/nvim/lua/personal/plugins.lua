-- Setup lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "--single-branch",
    "https://github.com/folke/lazy.nvim.git",
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup("custom.plugins", {
  ui = {
    icons = {
      cmd = "⌘",
      config = "🛠",
      event = "📅",
      ft = "📂",
      init = "⚙",
      keys = "🗝",
      plugin = "🔌",
      runtime = "💻",
      source = "📄",
      start = "🚀",
      task = "📌",
    },
  },
})

-- {
--   -- Tabs & Status
--   {
--     "nvim-tree/nvim-web-devicons",
--     dependencies = {
--       { "nvim-lualine/lualine.nvim", event = "VeryLazy" },
--       --{ "romgrk/barbar.nvim",        event = "VeryLazy" }
--     }
--   },
--   -- Detect tabstop/shiftwidth
--   "tpope/vim-sleuth",
--   -- LSP
--   {
--     "neovim/nvim-lspconfig",
--     dependencies = {
--       "williamboman/mason.nvim",
--       "williamboman/mason-lspconfig.nvim",
--       "jose-elias-alvarez/null-ls.nvim",
--       { "j-hui/fidget.nvim", opts = {} },
--       "folke/neodev.nvim"
--     },
--   },
--   -- Autocomplete
--   {
--     "hrsh7th/nvim-cmp",
--     version = false,
--     dependencies = {
--       "onsails/lspkind-nvim",
--       "hrsh7th/cmp-nvim-lua",
--       "hrsh7th/cmp-nvim-lsp",
--       { "saadparwaiz1/cmp_luasnip", dependencies = { "L3MON4D3/LuaSnip" } },
--       {
--         "zbirenbaum/copilot-cmp",
--         dependencies = {
--           "zbirenbaum/copilot.lua",
--           opts = {
--             suggestion = { enabled = false },
--             panel = { enabled = false }
--           }
--         },
--         opts = {},
--         config = function(_, opts)
--           local copilot_cmp = require("copilot_cmp")
--           copilot_cmp.setup(opts)
--           vim.api.nvim_create_autocmd("LspAttach", {
--             callback = function(args)
--               local client = vim.lsp.get_client_by_id(args.data.client_id)
--               if client.name == "copilot" then
--                 copilot_cmp._on_insert_enter()
--               end
--             end
--           })
--         end
--       },
--     }
--   },
--   -- Comment automagically
--   { "numToStr/Comment.nvim",     opts = {} },
--   -- Highlight code
--   {
--     "nvim-treesitter/nvim-treesitter",
--     version = false,
--     config = function() pcall(require("nvim-treesitter.install").update({ with_sync = true })) end,
--     dependencies = {
--       "nvim-treesitter/nvim-treesitter-textobjects",
--     }
--   },
--   -- Fuzzy finder
--   {
--     "nvim-telescope/telescope.nvim",
--     dependencies = {
--       "nvim-lua/plenary.nvim",
--       "nvim-telescope/telescope-file-browser.nvim",
--       "nvim-telescope/telescope-live-grep-args.nvim",
--       {
--         "nvim-telescope/telescope-fzf-native.nvim",
--         build = "make",
--         cond = function() return vim.fn.executable "make" == 1 end
--       },
--     }
--   },
--   { "rose-pine/neovim",          priority = 1000, name = "rose-pine" }, -- Theme
--   { "folke/tokyonight.nvim",     priority = 1000 },                     -- Theme
--   { "ellisonleao/gruvbox.nvim",  priority = 1000 },                     -- Theme
--   { "luisiacc/gruvbox-baby",     priority = 1000 },                     -- Theme
--   { "gruvbox-community/gruvbox", priority = 1000 },                     -- Theme
--   "ThePrimeagen/harpoon",                                               -- Marking per project
--   "kdheepak/lazygit.nvim",                                              -- Git
--   "windwp/nvim-autopairs",                                              -- Autopairs
--   "windwp/nvim-ts-autotag",                                             -- Autotags
--   { "glepnir/dashboard-nvim", event = "VimEnter" },                     -- Dashboard
--   "norcalli/nvim-colorizer.lua",                                        -- Colorizer
--   --"nvim-tree/nvim-tree.lua",                          -- File tree
--   {
--     "nvim-neo-tree/neo-tree.nvim",
--     dependencies = {
--       "MunifTanjim/nui.nvim",
--       "nvim-tree/nvim-web-devicons",
--       "nvim-lua/plenary.nvim"
--     }
--   },
--   "folke/zen-mode.nvim", -- Zen mode
--   -- { "b0o/incline.nvim",       event = "BufReadPre" }, -- Floating statuelines
--   "echasnovski/mini.ai", -- Improved text objects
--   "Wansmer/treesj",      -- Treesitter collapse/expand objects
--   { "folke/persistence.nvim", event = "BufReadPre", opts = {} }
-- })
