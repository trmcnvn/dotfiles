return {
	{
		"saghen/blink.cmp",
		lazy = false,
		dependencies = {
			"rafamadriz/friendly-snippets",
		},
		version = "*",
		build = "cargo build --release",
		opts = {
			keymap = { preset = "super-tab" },
		},
	},
}
