return {
  {
    "nvim-treesitter/nvim-treesitter",
    branch = "main",
    build = ":TSUpdate",
    lazy = false,
    config = function()
      vim.api.nvim_create_autocmd("FileType", {
        callback = function(args)
          local filetype = args.match
          local lang = pcall(vim.treesitter.language.get_lang, filetype) or ""
          if not vim.tbl_contains(require("nvim-treesitter.config").get_available(), lang) then
            return
          end

          require("nvim-treesitter").install(lang):await(function()
            vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
            vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
            vim.treesitter.start()
          end)
        end
      })
    end,
  },
}
