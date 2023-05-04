local ok, treesitter = pcall(require, "nvim-treesitter.configs")
if not ok then return end

treesitter.setup {
	ensure_installed = {
		"astro",
		"typescript",
		"toml",
		"fish",
		"json",
		"yaml",
		"css",
		"lua",
		"html",
		"svelte",
		"go",
		"ruby",
		"rust",
		"vim"
	},
	auto_install = true,
	context_commentstring = {
		enable = true,
		enable_autocmd = false,
	},
	highlight = {
		enable = true,
		additional_vim_regex_highlighting = false,
		disable = function(_, bufnr)
			local max_fs = 256 * 1024
			local ok, stats = pcall(vim.loop.fs_stat, vim.api.nvim_buf_get_name(bufnr))
			if ok and stats and stats.size > max_fs then return true end
		end
	},
	indent = { enable = true },
	autotag = { enable = true },
	textobjects = {
		select = {
			enable = true,
			lookahead = false,
			keymaps = {
				["aa"] = "@parameter.outer",
				["ia"] = "@parameter.inner",
				["af"] = "@function.outer",
				["if"] = "@function.inner",
				["ac"] = "@class.outer",
				["ic"] = "@class.inner"
			}
		},
		move = {
			enable = true,
			set_jumps = true,
			goto_next_start = {
				["]m"] = "@function.outer",
				["]]"] = "@class.outer"
			},
			goto_next_end = {
				["]M"] = "@function.outer",
				["]["] = "@class.outer"
			},
			goto_previous_start = {
				["[m"] = "@function.outer",
				["[["] = "@class.outer"
			},
			goto_previous_end = {
				["[M"] = "@function.outer",
				["[]"] = "@class.outer"
			}
		},
		swap = {
			enable = true,
			swap_next = {
				["<leader>a"] = "@parameter.inner"
			},
			swap_previous = {
				["<leader>A"] = "@parameter.inner"
			}
		}
	}
}
