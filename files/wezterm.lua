local wezterm = require("wezterm")
local colors = require("lua/rose-pine").colors()
local window_frame = require("lua/rose-pine").window_frame(wezterm)

wezterm.on(
  "format-tab-title",
  function(tab, _, _, _, _, max_width)
    return wezterm.truncate_right(tab.active_pane.title, max_width - 2)
  end
)

return {
  front_end = "WebGpu",
  --color_scheme = "tokyonight",
  --color_scheme = "Gruvbox Dark",
  colors = colors,
  window_frame = window_frame,
  force_reverse_video_cursor = true,
  font = wezterm.font("JetBrains Mono"),
  window_background_opacity = 1.0,
  max_fps = 120,
  scrollback_lines = 3500,
  font_size = 16.0,
  freetype_load_target = "Normal",
  hide_tab_bar_if_only_one_tab = true,
  tab_bar_at_bottom = true,
  use_fancy_tab_bar = true,
  --[[window_frame = {
    font = wezterm.font_with_fallback { "JetBrains Mono", "Cascadia Code", "Menlo", "Consolas" },
    font_size = 16.0,
    active_titlebar_bg = "#15161E"
  },]]
  window_padding = {
    left = 0,
    right = 0,
    top = 0,
    bottom = 0
  },
  --[[colors = {
    foreground = "#dcd7ba",
    background = "#1f1f28",
    cursor_bg = "#c8c093",
    cursor_fg = "#c8c093",
    cursor_border = "#c8c093",
    selection_fg = "#c8c093",
    selection_bg = "#2d4f67",
    scrollbar_thumb = "#16161d",
    split = "#16161d",
    ansi = { "#090618", "#c34043", "#76946a", "#c0a36e", "#7e9cd8", "#957fb8", "#6a9589", "#c8c093" },
    brights = { "#727169", "#e82424", "#98bb6c", "#e6c384", "#7fb4ca", "#938aa9", "#7aa89f", "#dcd7ba" },
    indexed = { [16] = "#ffa066", [17] = "#ff5d62" },
    tab_bar = {
      inactive_tab_edge = "#16161d",
      active_tab = {
        bg_color = "#1f1f28",
        fg_color = "#dcd7ba",
      },
      inactive_tab = {
        bg_color = "#1f1f28",
        fg_color = "#c8c093"
      }
    }
  },]]
  keys = {
    { key = "Enter", mods = "CMD", action = wezterm.action.SplitHorizontal { domain = "CurrentPaneDomain" } },
    { key = "Enter", mods = "CMD|CTRL", action = wezterm.action.SplitVertical { domain = "CurrentPaneDomain" } },
    { key = 'L', mods = 'CTRL', action = wezterm.action.ShowDebugOverlay },
  },
  mouse_bindings = {
    {
      event = { Up = { streak = 1, button = "Left" } },
      mods = "CMD",
      action = wezterm.action.OpenLinkAtMouseCursor,
    },
  },
  hyperlink_rules = {
    -- URLs
    {
      regex = [[\b\w+://[\w.-]+\.[a-z]{2,15}\S*\b]],
      format = "$0",
    },
    {
      regex = [[\b\w+://(?:[\w.-]+):\d+\S*\b]],
      format = "$0"
    },
    -- Files
    {
      regex = [[\bfile://\S*\b]],
      format = "$0",
    },
    -- Things that look like URLs
    {
      regex = [[\b\w+://(?:[\d]{1,3}\.){3}[\d]{1,3}\S*\b]],
      format = "$0",
    }
  }
}
