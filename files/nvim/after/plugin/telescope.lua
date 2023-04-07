local status, telescope = pcall(require, "telescope")
if (not status) then return end
local actions = require("telescope.actions")
local builtin = require("telescope.builtin")

local fb_actions = require("telescope").extensions.file_browser.actions

telescope.setup({
  defaults = {
    prompt_prefix = "  ",
    initial_mode = "normal",
    mappings = {
      i = {
        ["<C-u>"] = false,
        ["<C-d>"] = false
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
    --find_files = { theme = "dropdown" },
    --live_grep = { theme = "dropdown" },
    --buffers = { theme = "dropdown" },
    --oldfiles = { theme = "dropdown" },
  },
  extensions = {
    file_browser = {
      --theme = "dropdown",
      hijack_netrw = true,
      mappings = {
        ["i"] = {
          ["<C-w>"] = function() vim.cmd("normal vbd") end,
        },
        ["n"] = {
          ["N"] = fb_actions.create,
          ["h"] = fb_actions.goto_parent_dir,
          ["/"] = function() vim.cmd("startinsert") end
        }
      }
    },
    fzf = {
      fuzzy = true,
      override_generic_sorter = true,
      override_file_sorter = true,
      case_mode = "ignore_case",
    },
    live_grep_args = {
      auto_quoting = true,
    }
  }
})

--telescope.load_extension("harpoon")
telescope.load_extension("file_browser")
telescope.load_extension("fzf")

local function telescope_buffer_dir()
  return vim.fn.expand("%:p:h")
end

local function file_browser(hidden)
  telescope.extensions.file_browser.file_browser({
    path = "%:p:h",
    cwd = telescope_buffer_dir(),
    respect_gitignore = true,
    hidden = hidden,
    grouped = true,
    initial_mode = "normal",
    layout_config = { height = 40 }
  })
end

local M = require("utils.keymaps")
M.n("<leader>f", function() builtin.find_files() end)
M.n("<leader>df", function() builtin.find_files({ cwd = "~/code/dotfiles" }) end)
M.n("<leader>o", function() builtin.oldfiles() end)
M.n("<leader>r", function() builtin.live_grep({ previewer = false }) end)
M.n("<leader>R", function() require("telescope").extensions.live_grep_args.live_grep_args({ previewer = false }) end)
-- Open buffers
M.n("<leader><space>", function() builtin.buffers() end)
-- Search within buffer
M.n("<leader>/", function()
  builtin.current_buffer_fuzzy_find(require("telescope.themes").get_dropdown {
    winblend = 10,
    previewer = false,
    initial_mode = "insert"
  })
end)
M.n("<leader>e", function() file_browser(false) end)
M.n("<leader>E", function() file_browser(true) end)
-- LSP
M.n("<leader>gr", function() builtin.lsp_references() end)
M.n("gd", function() builtin.lsp_definitions() end)
M.n("gt", function() builtin.lsp_type_definitions() end)
M.n("gi", function() builtin.lsp_implementations() end)
-- Harpoon
M.n("<leader>h", function() require('harpoon.cmd-ui').toggle_quick_menu() end)
