local wezterm = require("wezterm")
local colors = require("lua/rose-pine").colors()
local window_frame = require("lua/rose-pine").window_frame(wezterm)

-- wezterm.on(
--   "format-tab-title",
--   function(tab, _, _, _, _, max_width)
--     return wezterm.truncate_right(tab.active_pane.title, max_width - 2)
--   end
-- )

-- Allow CMD to be used as ALT within nvim
local nvim_cmd_to_opt = function(opts)
  local keys = { "s", "w", "a" }
  local map = opts
  for _, key in ipairs(keys) do
    table.insert(map, {
      key = key,
      mods = "CMD",
      action = wezterm.action_callback(function(window, pane)
        if pane:get_foreground_process_name():sub(-4) == "nvim" then
          window:perform_action(wezterm.action.SendKey { key = key, mods = "META" }, pane)
        else
          window:perform_action(wezterm.action.SendKey { key = key, mods = "CMD" }, pane)
        end
      end)
    })
  end
  return map
end

return {
  audible_bell = "Disabled",
  front_end = "WebGpu",
  colors = colors,
  window_frame = window_frame,
  force_reverse_video_cursor = true,
  adjust_window_size_when_changing_font_size = false,
  font = wezterm.font_with_fallback {
    "Berkeley Mono",
    "Cartograph CF",
    "IBM Plex Mono",
    "Dank Mono",
    "JetBrains Mono",
    "Menlo",
    "JetBrainsMono Nerd Font",
  },
  background = {
    {
      source = { Color = colors.background },
      height = "100%",
      width = "100%",
      opacity = 1.0
    },
    { source = { File = "/Users/trmcnvn/Downloads/kurisu_dark.png" }, opacity = 0.2 },
  },
  window_background_opacity = 1.0,
  window_background_tint = 0.0,
  text_background_opacity = 1.0,
  scrollback_lines = 3500,
  font_size = 16,
  hide_tab_bar_if_only_one_tab = true,
  tab_bar_at_bottom = true,
  use_fancy_tab_bar = false,
  window_padding = {
    left = 0,
    right = 0,
    top = 0,
    bottom = 0
  },
  keys = nvim_cmd_to_opt({
    { key = "Enter", mods = "CMD",      action = wezterm.action.SplitHorizontal { domain = "CurrentPaneDomain" } },
    { key = "Enter", mods = "CMD|CTRL", action = wezterm.action.SplitVertical { domain = "CurrentPaneDomain" } },
    { key = "L",     mods = 'CTRL',     action = wezterm.action.ShowDebugOverlay },
  }),
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
