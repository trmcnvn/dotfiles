local status, dash = pcall(require, "dashboard")
if (not status) then return end

dash.setup({
  theme = "hyper",
  config = {
    week_header = {
      enable = true
    },
    shortcut = {
      {
        desc = "Open last session",
        group = "@property",
        key = "l",
        action = "lua require(\"persistence\").load({ last = true })"
      },
      { desc = "Lazy update", group = "@property", key = "u", action = "Lazy update" }
    }
  },
  hide = {
    statusline = true,
    tabline = true,
    winbar = true
  },
})
