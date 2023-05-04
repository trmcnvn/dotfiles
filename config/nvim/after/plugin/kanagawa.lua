local ok, kanagawa = pcall(require, "kanagawa")
if not ok then return end

kanagawa.setup {
	compile = false,
	undercurl = true,
	commentStyle = { italic = true },
	keywordStyle = { italic = false },
	statementStyle = { bold = false },
	terminalColors = true,
	background = {
		dark = "dragon",
		light = "lotus"
	}
}

--vim.cmd.colorscheme("kanagawa")
