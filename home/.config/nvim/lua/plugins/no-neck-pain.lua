return {
	pack = { src = "https://github.com/shortcuts/no-neck-pain.nvim" },
	config = function()
		require("no-neck-pain").setup({
			width = 120,
			fallbackOnBufferDelete = true,
			autocmds = {
				enableOnVimEnter = false,
				reloadOnColorSchemeChange = true,
			},
			buffers = {
				setNames = true,
				bo = {
					filetype = "no-neck-pain",
					buftype = "nofile",
				},
			},
			mappings = {
				enabled = true,
				toggle = "<leader>z",
			},
		})
	end,
}
