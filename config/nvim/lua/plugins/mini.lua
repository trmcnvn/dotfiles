return {
	pack = { src = "https://github.com/nvim-mini/mini.nvim" },
	config = function()
		local M = require("utils.keymaps")
		require("mini.extra").setup()

		-- Tabline
		require("mini.tabline").setup({
			tabpage_section = "right",
		})
		M.n("<Tab>", "<cmd>bnext<cr>", { desc = "Next buffer" })
		M.n("<S-Tab>", "<cmd>bprevious<cr>", { desc = "Previous buffer" })

		-- Buffer Remove
		require("mini.bufremove").setup()
		M.n("<leader>w", function()
			MiniBufremove.delete(0)
		end, { desc = "Close buffer" })

		-- Icons
		require("mini.icons").setup({
			file = {
				[".gitkeep"] = { glyph = "󰊢", hl = "MiniIconsGrey" },
				[".keep"] = { glyph = "󰊢", hl = "MiniIconsGrey" },
			},
			filetype = {
				dotenv = { glyph = "", hl = "MiniIconsYellow" },
			},
		})
		MiniIcons.mock_nvim_web_devicons()
		MiniIcons.tweak_lsp_kind()

		-- Completion
		require("mini.completion").setup({
			mappings = {
				scroll_down = "<C-d>",
				scroll_up = "<C-u>",
			},
		})
		M.i("<Tab>", [[pumvisible() ? "<C-n>" : "<Tab>"]], { expr = true })
		M.i("<S-Tab>", [[pumvisible() ? "<C-p>" : "<S-Tab>"]], { expr = true })
		M.i("<CR>", function()
			if vim.fn.complete_info()["selected"] ~= -1 then
				return "\25"
			end
			return "\r"
		end, { expr = true })

		-- Starter (Dashboard)
		require("mini.starter").setup()

		-- Notify
		require("mini.notify").setup()

		-- Picker
		require("mini.pick").setup({
			window = {
				config = function()
					local height = math.floor(0.618 * vim.o.lines)
					local width = math.floor(0.618 * vim.o.columns)
					return {
						anchor = "NW",
						height = height,
						width = width,
						row = math.floor(0.5 * (vim.o.lines - height)),
						col = math.floor(0.5 * (vim.o.columns - width)),
					}
				end,
			},
		})
		M.n("<leader>f", "<cmd>Pick files<cr>", { desc = "Find files" })
		M.n("<leader>r", "<cmd>Pick grep_live<cr>", { desc = "Live search" })
		M.n("<leader>o", "<cmd>Pick oldfiles<cr>", { desc = "Recent files" })
		M.n("<leader>df", function()
			MiniPick.builtin.files({ tool = "rg" }, { source = { cwd = vim.fn.expand("$HOME/code/dotfiles") } })
		end, { desc = "Dotfiles" })
	end,
}
