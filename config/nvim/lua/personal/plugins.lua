-- Bootstrap lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
	local lazyrepo = "https://github.com/folke/lazy.nvim.git"
	local out = vim.fn.system({ "git", "clone", "--filter=blob:none", "--branch=stable", lazyrepo, lazypath })
	if vim.v.shell_error ~= 0 then
		vim.api.nvim_echo({
			{ "Failed to clone lazy.nvim:\n", "ErrorMsg" },
			{ out, "WarningMsg" },
			{ "\nPress any key to exit..." },
		}, true, {})
		vim.fn.getchar()
		os.exit(1)
	end
end
vim.opt.rtp:prepend(lazypath)

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
		reset_packpath = true, -- Reset packpath to improve startup time
		rtp = {
			reset = true, -- Reset runtime path to default + plugins
			paths = {}, -- Add any custom paths here
			disabled_plugins = {
				"gzip",
				"matchit",
				"matchparen", 
				"netrwPlugin",
				"tarPlugin",
				"tohtml",
				"tutor",
				"zipPlugin",
			},
		},
	},
	checker = {
		enabled = false,
	},
	ui = {
		border = "single",
	},
})
