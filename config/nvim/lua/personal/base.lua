vim.cmd("autocmd!")

vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- Disable builtins
vim.g.loaded_gzip = 1
vim.g.loaded_zip = 1
vim.g.loaded_zipPlugin = 1
vim.g.loaded_tar = 1
vim.g.loaded_tarPlugin = 1
vim.g.loaded_getscript = 1
vim.g.loaded_getscriptPlugin = 1
vim.g.loaded_vimball = 1
vim.g.loaded_vimballPlugin = 1
vim.g.loaded_2html_plugin = 1
vim.g.loaded_matchit = 1
vim.g.loaded_matchparen = 1
vim.g.loaded_logiPat = 1
vim.g.loaded_rrhelper = 1
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1
vim.g.loaded_netrwSettings = 1
vim.g.loaded_python3_provider = 0
vim.g.loaded_node_provider = 0
vim.g.loaded_ruby_provider = 0
vim.g.loaded_perl_provider = 0

vim.scriptencoding = "utf-8"
vim.opt.encoding = "utf-8"
vim.opt.fileencoding = "utf-8"

-- Line numbers
vim.opt.nu = true
vim.wo.number = true
vim.opt.relativenumber = true

-- Enable mouse mode
vim.o.mouse = 'a'

vim.opt.title = true
vim.opt.autoindent = true
vim.opt.smartindent = true
vim.opt.hlsearch = false
vim.opt.backup = false
vim.opt.swapfile = false
vim.opt.undofile = true
vim.opt.undodir = os.getenv("HOME") .. "/.nvim/undodir"
vim.opt.undolevels = 5000
vim.opt.showcmd = true
vim.opt.cmdheight = 1
vim.opt.laststatus = 3
vim.opt.expandtab = false
vim.opt.grepformat = "%f:%l:%c:%m"
vim.opt.grepprg = "rg --vimgrep"
vim.opt.scrolloff = 5
vim.opt.signcolumn = "yes"
vim.opt.spelllang = { "en" }
vim.opt.splitbelow = true
vim.opt.splitright = true
vim.opt.shell = "fish"
vim.opt.backupskip = { "/tmp/*", "/private/tmp/*" }
vim.opt.inccommand = "nosplit"
vim.opt.smarttab = true
vim.opt.breakindent = true
vim.opt.shiftwidth = 2
vim.opt.shiftround = true
vim.opt.showmode = false
vim.opt.tabstop = 2
vim.opt.wrap = false
vim.opt.backspace = { "start", "eol", "indent" }
vim.opt.path:append { "**" }
vim.opt.wildignore:append { "*/node_modules/*" }
vim.opt.updatetime = 200
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.cursorline = true
vim.opt.termguicolors = true
vim.opt.winblend = 0
vim.opt.wildoptions = "pum"
vim.opt.wildmode = "longest:full,full"
vim.opt.pumblend = 0
vim.opt.pumheight = 10
vim.opt.background = "dark"
vim.opt.writebackup = false
vim.opt.timeout = true
vim.opt.timeoutlen = 300
vim.opt.completeopt = "menu,menuone,noselect"
vim.opt.guicursor = "n-v-c-i:block"
vim.opt.splitkeep = "cursor"

-- Turn off paste mode when leaving insert
vim.api.nvim_create_autocmd("InsertLeave", {
	pattern = "*",
	command = "set nopaste",
})

-- Add asterisks in block comments
vim.opt.formatoptions:append { "r" }

-- Highlight on yank
local hl_group = vim.api.nvim_create_augroup("YankHighlight", { clear = true })
vim.api.nvim_create_autocmd("TextYankPost", {
	callback = function()
		vim.highlight.on_yank({ timeout = 200 })
	end,
	group = hl_group,
	pattern = "*"
})

-- Reload files
local ct_group = vim.api.nvim_create_augroup("CheckTime", { clear = true })
vim.api.nvim_create_autocmd({ "FocusGained", "TermClose", "TermLeave" }, { group = ct_group, command = "checktime" })

-- Use 'q' to quit from common plugins
vim.api.nvim_create_autocmd({ "FileType" }, {
	pattern = { "qf", "help", "man", "lspinfo", },
	callback = function()
		vim.cmd([[
      nnoremap <silent> <buffer> q :close<CR>
      set nobuflisted
    ]])
	end,
})

-- Stop continuing comments
vim.api.nvim_create_autocmd("BufEnter", {
	command = "setlocal formatoptions-=o",
})
