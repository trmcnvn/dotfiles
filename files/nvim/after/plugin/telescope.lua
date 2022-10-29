local status, telescope = pcall(require, "telescope")
if (not status) then return end
local actions = require("telescope.actions")
local builtin = require("telescope.builtin")

local fb_actions = require("telescope").extensions.file_browser.actions

telescope.setup({
  defaults = {
    mappings = {
      n = {
        ["q"] = actions.close
      }
    }
  },
  extensions = {
    file_browser = {
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
    }
  }
})

telescope.load_extension("harpoon")
telescope.load_extension("file_browser")

local M = require("utils.keymaps")
local function telescope_buffer_dir()
  return vim.fn.expand("%:p:h")
end

M.n("<leader>f", function() builtin.find_files({ no_ignore = false, hidden = false }) end)
M.n("<leader>g", function() builtin.live_grep() end)
M.n("<leader>b", function() builtin.buffers() end)
M.n("<leader>e", function()
  telescope.extensions.file_browser.file_browser({
    path = "%:p:h",
    cwd = telescope_buffer_dir(),
    respect_gitignore = true,
    hidden = false,
    grouped = true,
    initial_mode = "normal",
    layout_config = { height = 40 }
  })
end)
