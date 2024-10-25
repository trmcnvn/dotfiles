return {
	{
		"rose-pine/neovim",
		config = function()
			require("rose-pine").setup({
				variant = "main",
				dark_variant = "main",
				enable = {
					legacy_highlights = false,
				},
				styles = {
					italic = false,
				},
				highlight_groups = {
					Comment = { fg = "muted", italic = false },
					Constant = { fg = "gold", italic = false },
					Keyword = { fg = "pine", italic = false },
					ColorColumn = { bg = "rose" },
					Pmenu = { fg = "highlight_high", bg = "base" },
					PmenuSel = { fg = "text", bg = "none" },
					NormalFloat = { bg = "base" },
					FloatBorder = { fg = "highlight_high" },
					FloatTitle = { bg = "base" },
					CursorLine = { bg = "highlight_low" },
					MatchParen = { bold = true, underline = true },
					-- Search
					CurSearch = { fg = "base", bg = "leaf", inherit = false },
					Search = { fg = "text", bg = "leaf", blend = 20, inherit = false },
					-- Telescope (Transparent)
					TelescopeBorder = { fg = "highlight_high", bg = "none" },
					TelescopeNormal = { bg = "none" },
					TelescopePromptNormal = { bg = "base" },
					TelescopeResultsNormal = { fg = "subtle", bg = "none" },
					TelescopeSelection = { fg = "text", bg = "base" },
					TelescopeSelectionCaret = { fg = "rose", bg = "rose" },
					-- nvim-cmp
					CmpItemAbbrMatchFuzzy = { fg = "foam", bold = true },
					CmpItemAbbrMatch = { fg = "rose", bold = true },
					CmpItemAbbrDeprecated = { fg = "subtle", strikethrough = true },
					CmpItemKindInterface = { fg = "rose" },
					CmpItemKindVariable = { fg = "rose" },
					CmpItemKindText = { fg = "rose" },
					CmpItemKindFunction = { fg = "love" },
					CmpItemKindMethod = { fg = "love" },
					CmpItemKindProperty = { fg = "text" },
					CmpItemKindUnit = { fg = "text" },
					CmpItemKindKeyword = { fg = "text" },
					CmpItemKindCopilot = { fg = "gold" },
					CmpItemKindSupermaven = { fg = "gold" },
					-- Fidget
					FidgetTitle = { fg = "subtle" },
					FidgetTask = { fg = "subtle" },
				},
			})
			vim.cmd.colorscheme("rose-pine-main")
		end,
	},
	{
		"catppuccin/nvim",
		config = function()
			require("catppuccin").setup({
				integrations = {
					cmp = true,
					fidget = true,
					harpoon = true,
					mason = true,
					native_lsp = { enabled = true },
					telescope = true,
					treesitter = true,
					treesitter_context = true,
				},
			})
		end,
	},
	{
		"folke/tokyonight.nvim",
		config = function()
			require("tokyonight").setup({})
		end,
	},
	{
		"metalelf0/jellybeans-nvim",
		dependencies = { "rktjmp/lush.nvim" },
		config = function()
			-- local lush = require("lush")
			-- local jellybeans = require("lush_theme.jellybeans-nvim")
			-- local spec = lush.extends({ jellybeans }).with(function()
			-- 	return {}
			-- end)
			-- lush(spec)
		end,
	},
	{
		"f-person/auto-dark-mode.nvim",
		priority = 1000,
		config = function()
			require("auto-dark-mode").setup({
				set_dark_mode = function()
					vim.opt.background = "dark"
					vim.cmd.colorscheme("rose-pine-main")
				end,
				set_light_mode = function()
					vim.opt.background = "light"
					vim.cmd.colorscheme("rose-pine-dawn")
				end,
			})
		end,
	},
}
