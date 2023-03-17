require("personal.base")
require("personal.maps")
require("personal.plugins")

local has = vim.fn.has
local is_mac = has "macunix"
local is_win = has "win32"

if is_mac then
  require("personal.macos")
end
if is_win then
  require("personal.windows")
end
