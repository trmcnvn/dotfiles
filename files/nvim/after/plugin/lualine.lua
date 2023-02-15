local status, lualine = pcall(require, "lualine")
if (not status) then return end

lualine.setup({
  options = {
    icons_enabled = true,
    theme = "kanagawa",
    --theme = "tokyonight",
    section_separators = { left = '', right = '' },
    component_separators = { left = '', right = '' },
    disabled_filetypes = {}
  },
  sections = {
    lualine_a = { { "mode", fmt = function(str) return str:sub(1, 1) end } },
    lualine_b = { "branch" },
    lualine_c = {
      { "filename", file_status = true, path = 0 },
      { "diff" },
      {
        function()
          local msg = ""
          local buf_ft = vim.api.nvim_buf_get_option(0, "filetype")
          local clients = vim.lsp.buf_get_clients()
          if next(clients) == nil then return msg end

          local client_table = {}
          for _, client in pairs(clients) do
            local filetypes = client.config.filetypes
            if filetypes and vim.fn.index(filetypes, buf_ft) ~= -1 then
              table.insert(client_table, client.name)
            end
          end

          if #client_table > 0 then
            return table.concat(client_table, ",")
          end

          return msg
        end,
      }
    },
    lualine_x = {
      { "diagnostics", sources = { "nvim_diagnostic" }, symbols = { error = ' ', warn = ' ', info = ' ',
        hint = ' ' } },
      "encoding",
      "filetype"
    },
    lualine_y = { "progress" },
    lualine_z = { "location" }
  },
  inactive_sections = {
    lualine_a = {},
    lualine_b = {},
    lualine_c = { {
      "filename",
      file_status = true,
      path = 1,
    } },
    lualine_x = { "location" },
    lualine_y = {},
    lualine_z = {}
  },
  tabline = {}
})
