local ok, el = pcall(require, "el")
if not ok then return end

el.reset_windows()

local builtins = require("el.builtin")
local extensions = require("el.extensions")
local sections = require("el.sections")

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
