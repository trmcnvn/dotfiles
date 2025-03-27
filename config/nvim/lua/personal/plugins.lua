-- Bootstrap lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
	local lazyrepo = "https://github.com/folke/lazy.nvim.git"
	local success = vim.fn.system({
		"git",
		"clone",
		"--filter=blob:none",
		"--single-branch",
		lazyrepo,
		lazypath,
	}) == 0

	if not success then
		vim.notify("Failed to clone lazy.nvim from " .. lazyrepo, vim.log.levels.ERROR)
		return
	end
end
vim.opt.runtimepath:prepend(lazypath)

-- Setup lazy.nvim
require("lazy").setup({
	spec = {
		import = "plugins", -- Load plugins from lua/plugins/
	},
	-- Disable luarocks integration
	rocks = { enabled = false },
	performance = {
		cache = {
			enabled = true, -- Enable caching for faster startup
		},
	},
	checker = {
		enabled = false,
	},
	ui = {
		border = "single",
	},
})
