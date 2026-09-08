return {
	pack = { src = "https://github.com/saghen/blink.cmp", version = "v1.9.1" },
	config = function()
		require("blink.cmp").setup({
			keymap = { preset = "super-tab" },
			appearance = {
				use_nvim_cmp_as_default = false,
				nerd_font_variant = "mono",
			},
			sources = {
				default = { "lsp", "path", "buffer" },
				providers = {
					lsp = { score_offset = 1000 },
					path = { score_offset = 3 },
					buffer = {
						score_offset = -150,
						min_keyword_length = 3,
					},
				},
			},
			signature = {
				enabled = true,
				trigger = {
					show_on_trigger_character = false,
					show_on_insert_on_trigger_character = false,
				},
				window = {
					border = "rounded",
					show_documentation = true,
				},
			},
			completion = {
				trigger = { show_on_insert_on_trigger_character = true },
				menu = {
					border = "rounded",
					max_height = 10,
					draw = {
						columns = {
							{ "kind_icon" },
							{ "label", "label_description", gap = 1 },
							{ "source_name" },
						},
						components = {
							source_name = {
								text = function(ctx)
									local source_names = {
										lsp = "[LSP]",
										buffer = "[Buffer]",
										path = "[Path]",
									}
									return (source_names[ctx.source_name] or "[") .. ctx.source_name .. "]"
								end,
								highlight = "CmpItemMenu",
							},
						},
					},
					auto_show = true,
				},
				documentation = {
					auto_show = true,
					window = { border = "rounded" },
				},
				ghost_text = {
					show_with_selection = false,
				},
				list = {
					selection = { preselect = true },
				},
				accept = {
					auto_brackets = { enabled = true },
				},
			},
		})
	end,
}
