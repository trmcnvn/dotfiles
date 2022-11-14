local wezterm = require("wezterm")

return {
  color_scheme = "tokyonight",
  font = wezterm.font_with_fallback {
    "JetBrains Mono"
  },
  dpi = 114.0,
  font_size = 16.0,
  freetype_load_target = "Normal",
  hide_tab_bar_if_only_one_tab = true,
  tab_bar_at_bottom = true,
  window_frame = {
    font = wezterm.font_with_fallback { "JetBrains Mono" },
    font_size = 16.0,
    active_titlebar_bg = "#1a1b26",
    inactive_titlebar_bg = "#1a1b26",
  },
  window_padding = {
    left = 0,
    right = 0,
    top = 0,
    bottom = 0
  },
  colors = {
    tab_bar = {
      inactive_tab_edge = "#1a1b26",
      active_tab = {
        bg_color = "#1a1b26",
        fg_color = "#c0caf5",
      },
      inactive_tab = {
        bg_color = "#1a1b26",
        fg_color = "#7aa2f7"
      }
    }
  },
  keys = {
    { key = "Enter", mods = "CMD", action = wezterm.action.SplitHorizontal { domain = "CurrentPaneDomain" } },
    { key = "Enter", mods = "CMD|CTRL", action = wezterm.action.SplitVertical { domain = "CurrentPaneDomain" } },
  }
}
