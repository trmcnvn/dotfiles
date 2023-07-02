require("personal.base")
require("personal.maps")
require("personal.plugins")

local has = vim.fn.has
local is_mac = has "macunix"
local is_win = has "win32"
local is_nix = has "linux"

if is_mac then
  require("personal.macos")
end
if is_win then
  require("personal.windows")
end
if is_nix then
  require("personal.linux")
end
