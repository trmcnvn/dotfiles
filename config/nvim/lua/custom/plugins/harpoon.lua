return {
	{
		"ThePrimeagen/harpoon",
		opts = {},
		config = function()
			local M = require("utils.keymaps")
			M.n("<leader>h", function() require("harpoon.cmd-ui").toggle_quick_menu() end)
			M.n("<C-\\>", "<cmd>lua require(\"harpoon.mark\").add_file()<CR>")
			M.n("<C-[>", "<cmd>lua require(\"harpoon.ui\").nav_prev()<CR>")
			M.n("<C-]>", "<cmd>lua require(\"harpoon.ui\").nav_next()<CR>")
		end
	}
}
