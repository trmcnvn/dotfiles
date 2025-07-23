return {
	pack = { src = "https://github.com/L3MON4D3/LuaSnip" },
	config = function()
		require("luasnip").config.set_config({
			history = true,
			updateevents = "TextChanged,TextChangedI",
		})
		require("luasnip.loaders.from_vscode").lazy_load()
		require("luasnip.loaders.from_snipmate").lazy_load()
		require("luasnip.loaders.from_lua").lazy_load()
	end,
}
