local status, dash = pcall(require, "dashboard")
if (not status) then return end

dash.setup({
  theme = "hyper",
  config = {
    week_header ={
      enable = true
    }
  }
})
