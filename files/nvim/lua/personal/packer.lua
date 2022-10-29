vim.cmd [[packadd packer.nvim]]
require("packer").startup(function()
  use "wbthomason/packer.nvim"
  use {
    "williamboman/mason.nvim",
    "williamboman/mason-lspconfig.nvim",
    "neovim/nvim-lspconfig",
  }
  -- Themes
  use "folke/tokyonight.nvim"
  use "gruvbox-community/gruvbox"
  use "catppuccin/nvim"

  use { "nvim-treesitter/nvim-treesitter", run = ":TSUpdate" }
  use "nvim-tree/nvim-web-devicons"
  use {
    "nvim-telescope/telescope.nvim",
    tag = "0.1.0",
    requires = { {"nvim-lua/plenary.nvim"} }
  }
  use {
    "nvim-tree/nvim-tree.lua",
    tag = "nightly"
  }
  use "nvim-lualine/lualine.nvim"
  use "kdheepak/lazygit.nvim"
  use "github/copilot.vim"
  use {
    "ms-jpq/coq_nvim",
    branch = "coq",
    requires = { {"ms-jpq/coq.artifacts", branch = "artifacts"}, {"ms-jpq/coq.thirdparty", branch = "3p"} }
  }
  use "romgrk/barbar.nvim"
  use "ThePrimeagen/harpoon"
end)

require("telescope").load_extension("harpoon")
require("lualine").setup({})
require("bufferline").setup({
  animation = false,
  auto_hide = true,
  insert_at_end = true,
})
