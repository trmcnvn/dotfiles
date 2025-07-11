vim.diagnostic.config({
  virtual_text = false,
  virtual_lines = false,
  float = {
    border = "single",
  },
  jump = { float = true },
})

vim.api.nvim_create_autocmd("LspAttach", {
  callback = function(ev)
    local client = vim.lsp.get_client_by_id(ev.data.client_id)
    if client and client:supports_method("textDocument/completion") then
      vim.lsp.completion.enable(true, client.id, ev.buf, { autotrigger = false })
    end

    if client and client:supports_method("textDocument/documentColor") then
      vim.lsp.document_color.enable(true, ev.buf, { style = "virtual" })
    end

    if client and client:supports_method("textDocument/foldingRange") then
      local win = vim.api.nvim_get_current_win()
      vim.wo[win][0].foldexpr = "v:lua.vim.lsp.foldexpr()"
    end

    vim.keymap.set("n", "gq", function()
      vim.lsp.buf.format()
    end)
  end,
})
