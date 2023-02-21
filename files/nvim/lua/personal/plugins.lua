local status, packer = pcall(require, "packer")
if (not status) then
  print("Packer is not installed")
  return
end

vim.cmd [[packadd packer.nvim]]

packer.startup(function(use)
  use "wbthomason/packer.nvim"
  use "nvim-lualine/lualine.nvim" -- Statusline
  use "nvim-lua/plenary.nvim" -- Common utils
  use "onsails/lspkind-nvim" -- vscode-like pictograms
  use "hrsh7th/cmp-buffer" -- nvim-csp source for buffers
  use "hrsh7th/cmp-nvim-lsp" --  nvim-cmp source for neovim lsp
  use "hrsh7th/nvim-cmp" -- completion
  use "neovim/nvim-lspconfig" -- LSP
  use "L3MON4D3/LuaSnip" -- Snippets
  use "williamboman/mason.nvim" -- LSP
  use "williamboman/mason-lspconfig.nvim" -- LSP
  use "jose-elias-alvarez/null-ls.nvim" -- LSP
  use {
    "nvim-treesitter/nvim-treesitter",
    run = function() require("nvim-treesitter.install").update({ with_sync = true }) end,
  } -- Syntax
  use "alaviss/nim.nvim" -- Nim Syntax
  use "kyazdani42/nvim-web-devicons" -- Nerdfont icons
  use "nvim-telescope/telescope.nvim" -- File finder/grep
  use "nvim-telescope/telescope-file-browser.nvim" -- File browser
  use "nvim-telescope/telescope-live-grep-args.nvim" -- Grep/rg args
  use "nvim-treesitter/nvim-treesitter-context" -- Context
  use { "nvim-telescope/telescope-fzf-native.nvim", run = "make" } -- Fuzzy finder
  use "folke/tokyonight.nvim" -- Theme
  use { "catppuccin/nvim", as = "catppuccin" } -- Theme
  use "sainnhe/gruvbox-material" -- Theme
  use "rebelot/kanagawa.nvim" -- Theme
  use "rose-pine/neovim" -- Theme
  use { "akinsho/bufferline.nvim", after = "catppuccin" } -- Tabs
  use "github/copilot.vim" -- AI Coding
  use "ThePrimeagen/harpoon" -- Marking per project
  use "kdheepak/lazygit.nvim" -- Git
  use "windwp/nvim-autopairs" -- Autopairs
  use "windwp/nvim-ts-autotag" -- Autotags
  use "glepnir/dashboard-nvim" -- Dashboard
  -- use "https://git.sr.ht/~whynothugo/lsp_lines.nvim" -- Better Diagnostic inline UI
  use "norcalli/nvim-colorizer.lua" -- Colorizer
  use "nvim-tree/nvim-tree.lua" -- File tree
end)
