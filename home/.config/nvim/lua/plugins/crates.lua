return {
	pack = { src = "https://github.com/saecki/crates.nvim" },
	config = function()
		require("crates").setup()
	end,
}
