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

		-- Diff
		require("mini.diff").setup({
			mappings = {
				apply = "",
				reset = "",
				textobject = "",
			},
		})
		M.n("<leader>go", function()
			MiniDiff.toggle_overlay(0)
		end)
	end,
}
