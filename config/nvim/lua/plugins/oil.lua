return {
	{
		"stevearc/oil.nvim",
		opts = {},
		config = function()
			require("oil").setup({
				cleanup_delay_ms = 2000,
				default_file_explorer = true,
				delete_to_trash = false,
				skip_confirm_for_simple_edits = true,
				prompt_save_on_select_new_entry = true,
				lsp_file_methods = {
					timeout_ms = 1000,
					autosave_changes = false,
				},
				constrain_cursor = "editable",
				watch_for_changes = false,
				use_default_keymaps = false,
				keymaps = {
					["<CR>"] = "actions.select",
					["q"] = "actions.close",
					["<esc>"] = "actions.close",
					["-"] = "actions.parent",
					["_"] = "actions.open_cwd",
					["g?"] = "actions.show_help",
					["g."] = "actions.toggle_hidden",
				},
				float = {
					max_width = 42,
					override = function(conf)
						return vim.tbl_extend("force", conf, { row = 2, col = 2 })
					end,
				},
			})

			local M = require("utils.keymaps")
			M.n("<leader>e", function()
				require("oil").toggle_float()
			end)

			-- Snacks integration
			vim.api.nvim_create_autocmd("User", {
				pattern = "OilActionsPost",
				callback = function(event)
					if event.data.actions.type == "move" then
						Snacks.rename.on_rename_file(event.data.actions.src_url, event.data.actions.dest_url)
					end
				end,
			})
		end,
	},
}
