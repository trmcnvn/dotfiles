local status, ts_context = pcall(require, 'treesitter-context')
if (not status) then return end

ts_context.setup {
  patterns = {
    ruby = { "context", "def", "module", "block", "do_block" }
  }
}
