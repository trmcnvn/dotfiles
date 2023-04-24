local ok, session = pcall(require, "persistence")
if not ok then return end

session.setup {
	options = { "globals" },
	pre_save = function()
		vim.api.nvim_exec_autocmds("User", { pattern = "SessionSavePre" })
	end,
}
