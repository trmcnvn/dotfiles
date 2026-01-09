return {
	pack = { src = "https://github.com/neovim/nvim-lspconfig" },
	config = function()
		require("lspconfig.configs")
	end,
}
