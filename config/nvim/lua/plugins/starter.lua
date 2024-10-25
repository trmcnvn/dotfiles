return {
	{
		"echasnovski/mini.starter",
		version = false,
		event = "VimEnter",
		opts = function()
			local logo = table.concat({
				" ███╗   ██╗ ███████╗ ██████╗  ██╗   ██╗ ██╗ ███╗   ███╗",
				" ████╗  ██║ ██╔════╝██╔═══██╗ ██║   ██║ ██║ ████╗ ████║",
				" ██╔██╗ ██║ █████╗  ██║   ██║ ██║   ██║ ██║ ██╔████╔██║",
				" ██║╚██╗██║ ██╔══╝  ██║   ██║ ╚██╗ ██╔╝ ██║ ██║╚██╔╝██║",
				" ██║ ╚████║ ███████╗╚██████╔╝  ╚████╔╝  ██║ ██║ ╚═╝ ██║",
				" ╚═╝  ╚═══╝ ╚══════╝ ╚═════╝    ╚═══╝   ╚═╝ ╚═╝     ╚═╝",
			}, "\n")
			local pad = string.rep(" ", 22)
			local starter = require("mini.starter")
			local config = {
				evaluate_single = true,
				header = logo,
				items = {
					{ name = "New file", action = "ene | startinsert", section = pad .. "Built-in" },
					{
						name = "Find file",
						action = 'lua require("telescope.builtin").find_files()',
						section = pad .. "Telescope",
					},
					{
						name = "Search",
						action = 'lua require("telescope.builtin").live_grep({ previewer = false })',
						section = pad .. "Telescope",
					},
					{
						name = "Recent files",
						action = 'lua require("telescope.builtin").oldfiles()',
						section = pad .. "Telescope",
					},
					{
						name = "Dotfiles",
						action = 'lua require("telescope.builtin").find_files({ cwd = "~/code/dotfiles" })',
						section = pad .. "Telescope",
					},
					{ name = "Lazy", action = "Lazy", section = pad .. "Plugins" },
					{ name = "Quit", action = "qa", section = pad .. "Built-in" },
				},
				content_hooks = {
					starter.gen_hook.adding_bullet(pad .. "░ ", false),
					starter.gen_hook.aligning("center", "center"),
				},
			}
			return config
		end,
		config = function(_, config)
			-- close Lazy and re-open when starter is ready
			if vim.o.filetype == "lazy" then
				vim.cmd.close()
				vim.api.nvim_create_autocmd("User", {
					pattern = "MiniStarterOpened",
					callback = function()
						require("lazy").show()
					end,
				})
			end

			local starter = require("mini.starter")
			starter.setup(config)

			vim.api.nvim_create_autocmd("User", {
				pattern = "MiniStarterOpened",
				callback = function(ev)
					local stats = require("lazy").stats()
					local ms = (math.floor(stats.startuptime * 100 + 0.5) / 100)
					local pad_footer = string.rep(" ", 8)
					starter.config.footer = pad_footer
						.. "⚡ Neovim loaded "
						.. stats.count
						.. " plugins in "
						.. ms
						.. "ms"
					if vim.bo[ev.buf].filetype == "ministarter" then
						pcall(starter.refresh)
					end
				end,
			})
		end,
	},
}
