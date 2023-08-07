local ok, el = pcall(require, "el")
if not ok then return end

el.reset_windows()

local builtins = require("el.builtin")
local extensions = require("el.extensions")
local sections = require("el.sections")
local subscribe = require("el.subscribe")
local lsp_statusline = require("el.plugins.lsp_status")
local diagnostic = require("el.diagnostic")

local has_lsp_extensions, ws_diagnostics = pcall(require, "lsp_extensions.workspace.diagnostic")

local filetype_icon = subscribe.buf_autocmd("el_file_icon", "BufRead", function(_, bufnr)
	local icon = extensions.file_icon(_, bufnr)
	if icon then return icon .. " " end
	return ""
end)

local diagnostic_display = diagnostic.make_buffer()

el.setup {
	generator = function()
		local mode = extensions.gen_mode { format_string = " %s " }
		return {
			{ mode,                                                             required = true },
			{ sections.split,                                                   required = true },
			{ sections.maximum_width(builtins.file_relative, 0.20),             required = true },
			{ sections.collapse_builtin { { " " }, { builtins.modified_flag } } },
			{ sections.split,                                                   required = true },
			{ " " },
			{
				sections.collapse_builtin {
					builtins.line_number,
					":",
					builtins.column_number,
				}
			},
		}
	end,
}
