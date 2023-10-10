return {
	{
		"ThePrimeagen/harpoon",
		opts = {},
		config = function()
			local M = require("utils.keymaps")
			M.n("<leader>h", "<cmd>Telescope harpoon marks<CR>")
			M.n("<A-\\>", "<cmd>lua require(\"harpoon.mark\").add_file()<CR>")
			M.n("<A-[>", "<cmd>lua require(\"harpoon.ui\").nav_prev()<CR>")
			M.n("<A-]>", "<cmd>lua require(\"harpoon.ui\").nav_next()<CR>")
		end
	}
}
