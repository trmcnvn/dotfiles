local wezterm = require("wezterm")
local catppuccin = require("lua/catppuccin").apply_to_config
local rose = require("lua/rose-pine")

local config = wezterm.config_builder()

-- Weeb mode
local weeb_mode_enabled = false

-- Transparent mode
local transparent_mode = false

-- Allow CMD to be used as ALT within nvim
local nvim_cmd_to_opt = function(opts)
  local keys = { "s", "w", "a", "[", "]", "\\" }
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

-- Select a random background image from a directory
local random_background = function()
  local images = {}
  local dir = "/Users/trmcnvn/backgrounds/anime"
  for file in io.popen("ls " .. dir):lines() do
    table.insert(images, dir .. "/" .. file)
  end
  return images[math.random(#images)]
end

local weeb_background = function()
  return {
    {
      source = { Color = "#1e1e2e" },
      height = "100%",
      width = "100%",
      opacity = 1.0
    },
    { source = { File = random_background() }, width = "100%", height = "100%", opacity = 0.1 },
  }
end

local transparent_backgrund = function()
  return {
    {
      source = {
        File =
        "/Users/trmcnvn/Desktop/lofigirl-lofi-black-cat-lantern-headsets-hd-wallpaper-18467d38b0e0dc28f00c419e6812141a.jpg"
      },
      height = "100%",
      width = "100%",
      opacity = 0.1
    },
    { source = { Color = "#1e1e2e" }, height = "100%", width = "100%", opacity = 0.9 },
  }
end
if transparent_mode then
  config.macos_window_background_blur = 20
end

-- Reload the config every 10 minutes
wezterm.time.call_after(600, function()
  if not weeb_mode_enabled then return end
  wezterm.reload_configuration()
end)

-- Theme
config.colors = rose.colors()
config.window_frame = rose.window_frame(wezterm)
-- catppuccin(config, {
--   flavour = "mocha",
--   accent = "surface0"
-- })
-- config.color_scheme = "Tokyo Night"

config.adjust_window_size_when_changing_font_size = false
config.alternate_buffer_wheel_scroll_speed = 6
config.audible_bell = "Disabled"
if weeb_mode_enabled then config.background = weeb_background() end
if transparent_mode then config.background = transparent_backgrund() end
config.check_for_updates = false
config.font = wezterm.font_with_fallback {
  -- "Dank Mono",
  "Berkeley Mono",
  "JetBrains Mono",
  "JetBrainsMono Nerd Font",
}
config.font_size = 16
config.line_height = 1.2
config.cell_width = 1
config.freetype_load_target = "Light"
config.front_end = "WebGpu"
config.hide_tab_bar_if_only_one_tab = true
config.hyperlink_rules = {
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
config.keys = nvim_cmd_to_opt({
  { key = "Enter", mods = "CMD",      action = wezterm.action.SplitHorizontal { domain = "CurrentPaneDomain" } },
  { key = "Enter", mods = "CMD|CTRL", action = wezterm.action.SplitVertical { domain = "CurrentPaneDomain" } },
  { key = "L",     mods = "CTRL",     action = wezterm.action.ShowDebugOverlay },
})
config.mouse_bindings = {
  {
    event = { Up = { streak = 1, button = "Left" } },
    mods = "CMD",
    action = wezterm.action.OpenLinkAtMouseCursor,
  },
}
config.scrollback_lines = 6000
config.tab_bar_at_bottom = true
config.text_background_opacity = 1.0
config.use_fancy_tab_bar = false
config.enable_scroll_bar = false
config.window_background_opacity = 1.0
config.window_padding = {
  left = 0,
  right = 0,
  top = 0,
  bottom = 0
}
config.window_decorations = "RESIZE|MACOS_FORCE_DISABLE_SHADOW"

return config
