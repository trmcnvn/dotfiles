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
      n = {
        ["q"] = actions.close
      }
    }
  },
  pickers = {
    find_files = { theme = "dropdown" },
    live_grep = { theme = "dropdown" },
    buffers = { theme = "dropdown" },
    oldfiles = { theme = "dropdown" },
  },
  extensions = {
    file_browser = {
      theme = "dropdown",
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
      case_mode = "smart_case",
    }
  }
})

telescope.load_extension("harpoon")
telescope.load_extension("file_browser")
telescope.load_extension("fzf")

local M = require("utils.keymaps")
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

M.n("<leader>f", function() builtin.find_files() end)
M.n("<leader>F", function() builtin.find_files({ hidden = true }) end)
M.n("<leader>df", function() builtin.find_files({ cwd = "~/code/dotfiles" }) end)
M.n("<leader>o", function() builtin.oldfiles() end)
M.n("<leader>g", function() builtin.live_grep() end)
M.n("<leader>b", function() builtin.buffers() end)
M.n("<leader>h", "<cmd>Telescope harpoon marks<CR>")
M.n("<leader>e", function() file_browser(false) end)
M.n("<leader>E", function() file_browser(true) end)
M.n("<leader>gr", function() builtin.lsp_references() end)
M.n("<leader>gd", function() builtin.lsp_definitions() end)
M.n("<leader>gt", function() builtin.lsp_type_definitions() end)
M.n("<leader>gi", function() builtin.lsp_implementations() end)
M.n("<leader>xd", function() builtin.diagnostics() end)
M.n("<leader>xs", function() builtin.lsp_document_symbols() end)
M.n("<leader>xq", function() builtin.quickfix() end)
