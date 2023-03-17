local status, incline = pcall(require, "incline")
if (not status) then
  return
end

incline.setup({
  window = {
    margin = {
      vertical = 0,
      horizontal = 0
    }
  },
  render = function(props)
    local filename = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(props.buf), ":t")
    local icon, color = require("nvim-web-devicons").get_icon_color(filename)
    return { { icon, guifg = color }, { " " }, { filename } }
  end
})
