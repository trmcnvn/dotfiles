local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable", -- latest stable release
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

local status, lazy = pcall(require, "lazy")
if (not status) then
  print("Lazy is not installed")
  return
end

lazy.setup({
  { "nvim-lualine/lualine.nvim", event = "ColorScheme" },
  { "romgrk/barbar.nvim",        event = "ColorScheme", dependencies = { "nvim-tree/nvim-web-devicons" } },
  "nvim-lua/plenary.nvim", -- Common utils
  "onsails/lspkind-nvim",  -- vscode-like pictograms
  {
    "hrsh7th/nvim-cmp",
    event = "InsertEnter",
    dependencies = {
      "hrsh7th/cmp-buffer",
      "hrsh7th/cmp-nvim-lsp",
      "hrsh7th/cmp-emoji",
    }
  },
  {
    "williamboman/mason.nvim",
    dependencies = {
      "neovim/nvim-lspconfig",
      "williamboman/mason-lspconfig.nvim",
      "jose-elias-alvarez/null-ls.nvim",
    },
  },
  {
    "nvim-treesitter/nvim-treesitter",
    init = function() require("nvim-treesitter.install").update({ with_sync = true }) end,
  },
  { "nvim-tree/nvim-web-devicons", priority = 1000 },
  {
    "nvim-telescope/telescope.nvim",
    dependencies = {
      "nvim-telescope/telescope-file-browser.nvim",
      "nvim-telescope/telescope-live-grep-args.nvim",
      { "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
    }
  },
  { "rose-pine/neovim",            priority = 1000 }, -- Theme
  "github/copilot.vim",                               -- AI Coding
  "ThePrimeagen/harpoon",                             -- Marking per project
  "kdheepak/lazygit.nvim",                            -- Git
  "windwp/nvim-autopairs",                            -- Autopairs
  "windwp/nvim-ts-autotag",                           -- Autotags
  "glepnir/dashboard-nvim",                           -- Dashboard
  "norcalli/nvim-colorizer.lua",                      -- Colorizer
  "nvim-tree/nvim-tree.lua",                          -- File tree
  "folke/zen-mode.nvim",                              -- Zen mode
  { "b0o/incline.nvim", event = "BufReadPre" },       -- Floating statuelines
  "echasnovski/mini.ai",                              -- Improved text objects
  "Wansmer/treesj",                                   -- Treesitter collapse/expand objects
  "folke/trouble.nvim",                               -- LSP diagnostics
})
