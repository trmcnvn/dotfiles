return {
	pack = { src = "https://github.com/folke/persistence.nvim" },
	config = function()
		require("persistence").setup({})
	end,
}
