return {
	pack = { src = "https://github.com/scottmckendry/cyberdream.nvim" },
	config = function()
		require("cyberdream").setup({
			variant = "dark",
		})
		-- vim.cmd.colorscheme("cyberdream")
	end,
}
