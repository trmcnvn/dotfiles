return {
	{
		"b0o/incline.nvim",
		event = "VeryLazy",
		config = function()
			require("incline").setup({
				window = {
					padding = 0,
					margin = { horizontal = 0, vertical = 0 },
				},
				render = function(props)
					local filename = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(props.buf), ":t")
					if filename == "" then
						filename = "[No Name]"
					end
					local ft_icon, ft_color = MiniIcons.get("file", filename)
					local res = {
						ft_icon and { " ", ft_icon, " ", group = ft_color } or "",
						{ filename },
					}
					table.insert(res, " ")
					return res
				end,
			})
		end,
	},
}
