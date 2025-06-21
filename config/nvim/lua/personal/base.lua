-- Leader Key
vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- Disable providers first for better startup performance
local disabled_providers = { "python3", "node", "ruby", "perl" }
for _, provider in ipairs(disabled_providers) do
	vim.g["loaded_" .. provider .. "_provider"] = 0
end

-- Disable built-in plugins
local disabled_plugins = {
	"gzip",
	"zip",
	"zipPlugin",
	"tar",
	"tarPlugin",
	"getscript",
	"getscriptPlugin",
	"vimball",
	"vimballPlugin",
	"2html_plugin",
	"matchit",
	"matchparen",
	"logiPat",
	"rrhelper",
	"netrw",
	"netrwPlugin",
	"netrwSettings",
}
for _, plugin in ipairs(disabled_plugins) do
	vim.g["loaded_" .. plugin] = 1
end

-- File and encoding settings
vim.opt.encoding = "utf-8"
vim.opt.fileencoding = "utf-8"
vim.opt.backup = false
vim.opt.swapfile = false
vim.opt.undofile = true

-- Create undodir if it doesn't exist
local undodir = vim.fn.stdpath("state") .. "/undo"
if vim.fn.isdirectory(undodir) == 0 then
	vim.fn.mkdir(undodir, "p")
end
vim.opt.undodir = undodir
vim.opt.undolevels = 5000
vim.opt.history = 1000

-- Shell configuration (detect or fallback)
local shell = vim.env.SHELL or "/bin/bash"
if vim.fn.executable("fish") == 1 then
	shell = "fish"
end
vim.opt.shell = shell

-- UI and appearance settings
vim.opt.number = true
vim.opt.relativenumber = false
vim.opt.numberwidth = 2
vim.opt.signcolumn = "yes"
vim.opt.cursorline = true
vim.opt.termguicolors = true
vim.opt.guicursor = "n-v-c-i:block"
vim.opt.showcmd = false
vim.opt.ruler = false
vim.opt.cmdheight = 1
vim.opt.laststatus = 3
vim.opt.showmode = false
vim.opt.showtabline = 0
vim.opt.scrolloff = 8
vim.opt.title = true
vim.opt.wrap = false
vim.opt.fillchars = { eob = " " }

-- Editing and indentation settings
vim.opt.autoindent = true
vim.opt.smartindent = true
vim.opt.expandtab = true
vim.opt.shiftwidth = 2
vim.opt.tabstop = 2
vim.opt.softtabstop = 2
vim.opt.smarttab = true
vim.opt.breakindent = true
vim.opt.shiftround = true
vim.opt.clipboard = "unnamed,unnamedplus"

-- Search and navigation settings
vim.opt.hlsearch = false
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.grepformat = "%f:%l:%c:%m,%f:%l:%m"
vim.opt.grepprg = "rg --vimgrep --no-heading --smart-case"
vim.opt.inccommand = "nosplit"

-- Window and split settings
vim.opt.splitbelow = true
vim.opt.splitright = true

-- Buffer and window management
vim.opt.hidden = true
vim.opt.confirm = true

-- Completion and command settings
vim.opt.wildmode = "longest:full,full"
vim.opt.pumheight = 10

-- Miscellaneous settings
vim.opt.mouse = "a"
vim.opt.updatetime = 250
vim.opt.timeout = true
vim.opt.timeoutlen = 400
vim.opt.completeopt = "menuone,noselect"
vim.opt.spelllang = "en"
vim.opt.sessionoptions = "buffers,curdir,folds,help,tabpages,winsize,winpos,terminal"

-- Append to options
vim.opt.backupskip:append("/tmp/*,/private/tmp/*")
vim.opt.path:append("**")
vim.opt.wildignore:append("*/node_modules/*")
vim.opt.formatoptions:append("r")
vim.opt.shortmess:append("sI")
vim.opt.whichwrap:append("<>[]hl")

-- Autocommands
local group = vim.api.nvim_create_augroup("custom_configs", { clear = true })

local function disable_paste_on_insert_leave()
	vim.opt.paste = false
end

local function highlight_yank()
	vim.highlight.on_yank({ timeout = 200, visual = true })
end

local function enable_text_features()
	vim.opt_local.wrap = true
	vim.opt_local.spell = true
end

vim.api.nvim_create_autocmd("InsertLeave", {
	group = group,
	pattern = "*",
	callback = disable_paste_on_insert_leave,
})

vim.api.nvim_create_autocmd("TextYankPost", {
	group = group,
	pattern = "*",
	callback = highlight_yank,
})

vim.api.nvim_create_autocmd("FileType", {
	group = group,
	pattern = { "gitcommit", "markdown", "txt" },
	callback = enable_text_features,
})

-- Convenient keymaps for common typos
vim.keymap.set("c", "W", "w", { desc = "Save file" })
vim.keymap.set("c", "Q", "q", { desc = "Quit" })
vim.keymap.set("c", "Wq", "wq", { desc = "Save and quit" })
vim.keymap.set("c", "WQ", "wq", { desc = "Save and quit" })

-- Filetype
vim.filetype.add({
	filename = {
		["justfile"] = "just",
		["*.mjml"] = "html",
	},
})
