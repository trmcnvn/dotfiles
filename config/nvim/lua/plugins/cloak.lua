return {
	{
		"laytan/cloak.nvim",
		opts = {
			patterns = {
				{
					file_pattern = { "*.env", ".env*" },
					cloak_pattern = "=.+",
				},
			},
		},
	},
}
