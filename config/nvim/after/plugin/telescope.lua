local ok, telescope = pcall(require, "telescope")
if not ok then return end

local actions = require("telescope.actions")
local builtin = require("telescope.builtin")

telescope.setup {
	defaults = {
		prompt_prefix = "  ",
		selection_caret = " ",
		initial_mode = "insert",
		file_ignore_patterns = { ".git/", "node_modules/", "%.svg" },
		mappings = {
			i = {
				["<Down>"] = actions.move_selection_next,
				["<Up>"] = actions.move_selection_previous,
				["<C-j>"] = actions.move_selection_next,
				["<C-k>"] = actions.move_selection_previous
			},
			n = {
				["q"] = actions.close
			}
		},
		layout_config = {
			horizontal = { preview_width = 80 },
			prompt_position = "top"
		},
		layout_strategy = "horizontal",
		sorting_strategy = "ascending",
		winblend = 0,
	},
	pickers = {
		find_files = { theme = "dropdown", previewer = false },
		live_grep = { theme = "dropdown", previewer = false },
		buffers = { theme = "dropdown", previewer = false },
		oldfiles = { theme = "dropdown", previewer = false },
	},
	extensions = {
		["zf-native"] = {
			file = {
				enable = true,
				highlight_results = true,
				match_filename = true
			},
			generic = {
				enable            = true,
				highlight_results = true,
				match_filename    = true
			}
		},
	}
}

telescope.load_extension("zf-native")
telescope.load_extension("ui-select")

local function telescope_buffer_dir()
	return vim.fn.expand("%:p:h")
end

local M = require("utils.keymaps")
M.n("<leader>f", function() builtin.find_files() end)
M.n("<leader>df", function() builtin.find_files({ cwd = "~/code/dotfiles" }) end)
M.n("<leader>o", function() builtin.oldfiles() end)
M.n("<leader>r", function() builtin.live_grep({ previewer = false }) end)
-- Open buffers
M.n("<leader><space>", function() builtin.buffers() end)
-- Search within buffer
M.n("<leader>/", function()
	builtin.current_buffer_fuzzy_find(require("telescope.themes").get_dropdown {
		winblend = 0,
		previewer = false,
		initial_mode = "insert"
	})
end)
-- LSP
M.n("<leader>gr", function() builtin.lsp_references() end)
M.n("gd", function() builtin.lsp_definitions() end)
M.n("gt", function() builtin.lsp_type_definitions() end)
M.n("gi", function() builtin.lsp_implementations() end)

