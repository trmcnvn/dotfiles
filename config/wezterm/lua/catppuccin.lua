local wezterm = require("wezterm")

local M = {}

local colors = {
    mocha = {
        rosewater = "#f5e0dc",
        flamingo = "#f2cdcd",
        pink = "#f5c2e7",
        mauve = "#cba6f7",
        red = "#f38ba8",
        maroon = "#eba0ac",
        peach = "#fab387",
        yellow = "#f9e2af",
        green = "#a6e3a1",
        teal = "#94e2d5",
        sky = "#89dceb",
        sapphire = "#74c7ec",
        blue = "#89b4fa",
        lavender = "#b4befe",
        text = "#cdd6f4",
        subtext1 = "#bac2de",
        subtext0 = "#a6adc8",
        overlay2 = "#9399b2",
        overlay1 = "#7f849c",
        overlay0 = "#6c7086",
        surface2 = "#585b70",
        surface1 = "#45475a",
        surface0 = "#313244",
        base = "#1e1e2e",
        mantle = "#181825",
        crust = "#11111b",
    },
}

local mappings = {
    mocha = "Catppuccin Mocha",
}

function M.select(palette, flavor, accent)
    local c = palette[flavor]
    return {
        foreground = c.text,
        background = '#191724',

        cursor_fg = c.crust,
        cursor_bg = c.rosewater,
        cursor_border = c.rosewater,

        selection_fg = c.text,
        selection_bg = c.surface2,

        scrollbar_thumb = c.surface2,

        split = c.overlay0,

        ansi = {
            c.surface1,
            c.red,
            c.green,
            c.yellow,
            c.blue,
            c.pink,
            c.teal,
            c.subtext1,
        },

        brights = {
            c.surface2,
            c.red,
            c.green,
            c.yellow,
            c.blue,
            c.pink,
            c.teal,
            c.subtext0,
        },

        indexed = { [16] = c.peach, [17] = c.rosewater },

        -- nightbuild only
        compose_cursor = c.flamingo,

        tab_bar = {
            background = c.crust,
            active_tab = {
                bg_color = c[accent],
                fg_color = c.text,
            },
            inactive_tab = {
                bg_color = c.mantle,
                fg_color = c.text,
            },
            inactive_tab_hover = {
                bg_color = c.base,
                fg_color = c.text,
            },
            new_tab = {
                bg_color = c.surface0,
                fg_color = c.text,
            },
            new_tab_hover = {
                bg_color = c.surface1,
                fg_color = c.text,
            },
            -- fancy tab bar
            inactive_tab_edge = c.surface0,
        },

        visual_bell = c.surface0,
    }
end

local function select_for_appearance(appearance, options)
    if appearance:find("Dark") then
        return options.dark
    else
        return options.light
    end
end

local function tableMerge(t1, t2)
    for k, v in pairs(t2) do
        if type(v) == "table" then
            if type(t1[k] or false) == "table" then
                tableMerge(t1[k] or {}, t2[k] or {})
            else
                t1[k] = v
            end
        else
            t1[k] = v
        end
    end
    return t1
end

function M.apply_to_config(c, opts)
    if not opts then
        opts = {}
    end

    -- default options
    local defaults = {
        flavor = "mocha",
        accent = "mauve",
        sync = false,
        sync_flavors = { light = "latte", dark = "mocha" },
        color_overrides = { mocha = {}, macchiato = {}, frappe = {}, latte = {} },
        token_overrides = { mocha = {}, macchiato = {}, frappe = {}, latte = {} },
    }

    local o = tableMerge(defaults, opts)

    -- insert all flavors
    local color_schemes = {}
    local palette = tableMerge(colors, o.color_overrides)
    for flavor, name in pairs(mappings) do
        local spec = M.select(palette, flavor, o.accent)
        local overrides = o.token_overrides[flavor]
        color_schemes[name] = tableMerge(spec, overrides)
    end
    if c.color_schemes == nil then
        c.color_schemes = {}
    end
    c.color_schemes = tableMerge(c.color_schemes, color_schemes)

    if opts.sync then
        c.color_scheme = select_for_appearance(wezterm.gui.get_appearance(), {
            dark = mappings[o.sync_flavors.dark],
            light = mappings[o.sync_flavors.light],
        })
        c.command_palette_bg_color = select_for_appearance(wezterm.gui.get_appearance(), {
            dark = colors[o.sync_flavors.dark].crust,
            light = colors[o.sync_flavors.light].crust,
        })
        c.command_palette_fg_color = select_for_appearance(wezterm.gui.get_appearance(), {
            dark = colors[o.sync_flavors.dark].text,
            light = colors[o.sync_flavors.light].text,
        })
    else
        c.color_scheme = mappings[o.flavor]
        c.command_palette_bg_color = colors[o.flavor].crust
        c.command_palette_fg_color = colors[o.flavor].text
    end

    local window_frame = {
        active_titlebar_bg = colors[o.flavor].crust,
        active_titlebar_fg = colors[o.flavor].text,
        inactive_titlebar_bg = colors[o.flavor].crust,
        inactive_titlebar_fg = colors[o.flavor].text,
        button_fg = colors[o.flavor].text,
        button_bg = colors[o.flavor].base,
    }

    if c.window_frame == nil then
        c.window_frame = {}
    end
    c.window_frame = tableMerge(c.window_frame, window_frame)
end

return M
