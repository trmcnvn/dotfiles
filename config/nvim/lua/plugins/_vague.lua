return {
	pack = { src = "https://github.com/vague2k/vague.nvim" },
	config = function()
		require("vague").setup({
			on_highlights = function(highlights, colors)
				highlights["SlimlineModeNormal"] = { bg = colors.bg, fg = colors.operator }
				highlights["SlimlineModeInsert"] = { bg = colors.bg, fg = colors.delta }
				highlights["SlimlineModeVisual"] = { bg = colors.bg, fg = colors.builtin }
				highlights["SlimlineModeReplace"] = { bg = colors.bg, fg = colors.string }
				highlights["SlimlineModeOther"] = { bg = colors.bg, fg = "#1c1c24" }
			end,
		})
		vim.cmd.colorscheme("vague")
	end,
}
