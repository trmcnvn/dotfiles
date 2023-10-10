return {
	{ "ziglang/zig.vim",              ft = "zig" },
	{ "iamcco/markdown-preview.nvim", ft = "markdown", build = ":lua vim.fn[\"mkdp#util#install\"]()" }
}
