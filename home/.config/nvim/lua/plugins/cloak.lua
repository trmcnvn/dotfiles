return {
	pack = { src = "https://github.com/laytan/cloak.nvim" },
	config = function()
		require("cloak").setup({
			patterns = {
				{
					file_pattern = { "**/.env*" },
					cloak_pattern = "=.+",
				},
				{
					file_pattern = { "**/config.toml" },
					cloak_pattern = "(token =) .+",
					replace = "%1 ",
				},
			},
		})
	end,
}
