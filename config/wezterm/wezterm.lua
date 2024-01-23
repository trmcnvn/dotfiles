local wezterm = require("wezterm")
local rose = require("lua/rose-pine")
local config = wezterm.config_builder()

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
					window:perform_action(wezterm.action.SendKey({ key = key, mods = "META" }), pane)
				else
					window:perform_action(wezterm.action.SendKey({ key = key, mods = "CMD" }), pane)
				end
			end),
		})
	end
	return map
end

-- Theme
config.colors = rose.colors()
config.window_frame = rose.window_frame(wezterm)
config.adjust_window_size_when_changing_font_size = false
config.alternate_buffer_wheel_scroll_speed = 6
config.audible_bell = "Disabled"
config.check_for_updates = false
config.font = wezterm.font_with_fallback({
	-- {
	--   family = "Monaspace Neon",
	--   harfbuzz_features = { "calt", "liga", "dlig", "ss01", "ss02", "ss03", "ss04", "ss05", "ss06", "ss07", "ss08" },
	-- },
	-- "Berkeley Mono",
	"BerkeleyMono Nerd Font Mono",
	-- "JetBrainsMono Nerd Font",
})
config.font_size = 16
config.use_cap_height_to_scale_fallback_fonts = true
config.line_height = 1
config.cell_width = 1
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
		format = "$0",
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
	},
}
config.keys = nvim_cmd_to_opt({
	{ key = "Enter", mods = "CMD", action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }) },
	{ key = "Enter", mods = "CMD|CTRL", action = wezterm.action.SplitVertical({ domain = "CurrentPaneDomain" }) },
	{ key = "L", mods = "CTRL", action = wezterm.action.ShowDebugOverlay },
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
	bottom = 0,
}
config.window_decorations = "RESIZE"
config.animation_fps = 60

return config
