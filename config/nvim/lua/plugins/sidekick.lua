return {
	pack = { src = "https://github.com/folke/sidekick.nvim" },
	config = function()
		require("sidekick").setup({
			cli = {
				tools = {
					claude = {
						cmd = { vim.fn.expand("$HOME/.claude/local/claude") },
					},
				},
			},
		})

		local M = require("utils.keymaps")
		M.bind({ "i", "n" })("<Tab>", function()
			if not require("sidekick").nes_jump_or_apply() then
				if not vim.lsp.inline_completion.get() then
					if vim.fn.mode() == "n" then
						return "<Cmd>BufferLineCycleNext<CR>"
					else
						return "<Tab>"
					end
				end
			end
		end, { expr = true, desc = "Goto/Apply Next Edit Suggestion" })

		M.bind({ "n", "x", "i", "t" })("<c-.>", function()
			require("sidekick.cli").focus()
		end, { desc = "Sidekick Focus" })

		M.e("<leader>aa", function()
			require("sidekick.cli").toggle({ name = "claude", focus = true })
		end, { desc = "Sidekick Claude Toggle" })
	end,
}
