local plugin_tbl = {}
local plugin_packs = {}
local plugin_dir = vim.fn.readdir(vim.fn.stdpath("config") .. "/lua/plugins")

-- Load all plugin files under lua/plugins, instead of having a massive
-- config file here
for _, file in ipairs(plugin_dir) do
	if file:match("%.lua$") then
		local module_name = "plugins." .. file:gsub("%.lua$", "")
		local ok, plugin = pcall(require, module_name)
		if ok and type(plugin) == "table" then
			table.insert(plugin_tbl, plugin)
			if type(plugin.pack) == "table" then
				table.insert(plugin_packs, plugin.pack)
			end
		end
	end
end

-- Add each plugin to vim.pack
vim.pack.add(plugin_packs)

-- Call the config function for each plugin
for _, plugin in ipairs(plugin_tbl) do
	if type(plugin.config) == "function" then
		pcall(plugin.config)
	end
end
