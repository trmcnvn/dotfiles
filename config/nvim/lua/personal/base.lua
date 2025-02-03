vim.cmd("autocmd!")

-- Leader Key
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

-- File encoding
vim.scriptencoding = "utf-8"
vim.opt.encoding = "utf-8"
vim.opt.fileencoding = "utf-8"

-- Line numbers
vim.opt.nu = true
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.numberwidth = 2

-- Enable mouse mode
vim.o.mouse = "a"

vim.opt.title = true
vim.opt.autoindent = true
vim.opt.smartindent = true -- Make indenting smarter
vim.opt.hlsearch = false -- Highlight all matches to recent search pattern
vim.opt.backup = false -- Backup file
vim.opt.swapfile = false -- Creation of a swapfile
vim.opt.undofile = true -- Enable persistent undo
vim.opt.undodir = os.getenv("HOME") .. "/.nvim/undodir"
vim.opt.undolevels = 5000
vim.opt.showcmd = false
vim.opt.ruler = false
vim.opt.cmdheight = 1 -- Space for command line log
vim.opt.laststatus = 3
vim.opt.expandtab = true -- Convert tabs to spaces
vim.opt.grepformat = "%f:%l:%c:%m,%f:%l:%m"
vim.opt.grepprg = "rg --vimgrep --no-heading --smart-case"
vim.opt.scrolloff = 10
vim.opt.sidescrolloff = 10
vim.opt.signcolumn = "yes" -- Always show the sign column
vim.opt.spelllang = "en"
vim.opt.splitbelow = true -- Panel splitting
vim.opt.splitright = true -- Panel splitting
vim.opt.shell = "fish"
vim.opt.backupskip:append("/tmp/*,/private/tmp/*")
vim.opt.inccommand = "nosplit"
vim.opt.smarttab = true
vim.opt.breakindent = true
vim.opt.shiftwidth = 2 -- The number of spaces inserted for each indentation
vim.opt.shiftround = true
vim.opt.showmode = false -- We don't need to see mode text: -- INSERT --
vim.opt.showtabline = 0 -- Always show tabs
vim.opt.tabstop = 2 -- Insert 2 spaces for a tab
vim.opt.softtabstop = 2 -- Number of spaces that <Tab> uses while editing
vim.opt.wrap = false -- Display lines as one long line
vim.opt.backspace = "start,eol,indent"
vim.opt.path:append("**")
vim.opt.wildignore:append("*/node_modules/*")
vim.opt.updatetime = 250 -- Faster completion
vim.opt.ignorecase = true -- Ignore case in search patterns
vim.opt.smartcase = true -- Smart case
vim.opt.cursorline = true -- Highlight the current line
vim.opt.termguicolors = true -- Set term gui colours
vim.opt.winblend = 0
vim.opt.wildoptions = "pum"
vim.opt.wildmode = "longest:full,full"
vim.opt.pumblend = 0
vim.opt.pumheight = 10 -- popup menu height
vim.opt.background = "dark"
vim.opt.writebackup = false -- If a file is being edited by another program, it is not allowed to be edited
vim.opt.timeout = true
vim.opt.timeoutlen = 400 -- Time to wait for a mapped sequence to complete
vim.opt.completeopt = "menuone,noselect" -- cmp
vim.opt.guicursor = "n-v-c-i:block"
vim.opt.splitkeep = "cursor"
vim.opt.conceallevel = 0 --`` Markdown
vim.opt.fillchars = "eob: "
vim.opt.shortmess:append("sI")
vim.opt.whichwrap:append("<>[]hl")
vim.opt.confirm = true
vim.opt.foldenable = false
vim.opt.clipboard = "unnamed,unnamedplus"

-- Turn off paste mode when leaving insert
vim.api.nvim_create_autocmd("InsertLeave", {
	pattern = "*",
	command = "set nopaste",
})

-- Add asterisks in block comments
vim.opt.formatoptions:append({ "r" })

-- Highlight on yank
vim.api.nvim_create_autocmd("TextYankPost", {
	group = vim.api.nvim_create_augroup("highlight_yank", { clear = true }),
	pattern = "*",
	callback = function()
		vim.highlight.on_yank({ timeout = 200, visual = true })
	end,
})

-- Edit text
vim.api.nvim_create_autocmd({ "FileType" }, {
	group = vim.api.nvim_create_augroup("edit_text", { clear = true }),
	pattern = { "gitcommit", "markdown", "txt" },
	callback = function()
		vim.opt_local.wrap = true
		vim.opt_local.spell = true
	end,
})

-- Use 'q' to quit from common plugins
vim.api.nvim_create_autocmd({ "FileType" }, {
	pattern = { "qf", "help", "man", "lspinfo" },
	callback = function()
		vim.cmd([[
      nnoremap <silent> <buffer> q :close<CR>
      set nobuflisted
    ]])
	end,
})

-- Stop continuing comments
vim.api.nvim_create_autocmd("BufWinEnter", {
	command = "setlocal formatoptions-=cro",
})

-- Sanity
vim.cmd([[command! W w]])
vim.cmd([[command! Q q]])
vim.cmd([[command! Wq wq]])

-- Filetype types
vim.filetype.add({
	filename = {
		["justfile"] = "just",
	},
})
