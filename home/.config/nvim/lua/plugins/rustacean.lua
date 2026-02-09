return {
	pack = { src = "https://github.com/mrcjkb/rustaceanvim" },
	config = function()
		local M = require("utils.capabilities")
		vim.g.rustaceanvim = {
			server = M.with_capabilities({}),
			cmd = function()
				local mason_registry = require("mason-registry")
				if mason_registry.is_installed("rust-analyzer") then
					local ra = mason_registry.get_package("rust-analyzer")
					local ra_filename = ra:get_receipt():get().links.bin["rust-analyzer"]
					return { ("%s/%s"):format(ra:get_install_path(), ra_filename or "rust-analyzer") }
				else
					return { "rust-analyzer" }
				end
			end,
		}
	end,
}
