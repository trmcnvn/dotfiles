local M = {}

-- Create a keymap binding function for a given mode (or modes)
local function bind(mode, outer_opts)
	outer_opts = vim.tbl_extend("force", { noremap = true }, outer_opts or {})

	return function(lhs, rhs, opts)
		opts = vim.tbl_extend("force", outer_opts, opts or {})
		vim.keymap.set(mode, lhs, rhs, opts)
	end
end

-- Mode-specific binding functions
M.n = bind("n") -- Normal mode
M.v = bind("v") -- Visual mode
M.x = bind("x") -- Visual block mode
M.t = bind("t") -- Terminal mode
M.e = bind({ "n", "v" }) -- Normal + Visual modes
M.i = bind("i") -- Insert mode
M.bind = bind

return M
