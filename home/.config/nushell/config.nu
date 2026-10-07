# Nushell Config
$env.config.show_banner = false
$env.config.highlight_resolved_externals = false

# Keep recognized external commands non-bold
$env.config.color_config = ($env.config.color_config | merge {
    shape_external: "cyan"
    shape_external_resolved: "cyan"
    shape_internalcall: "cyan"
    shape_custom: "green"
    shape_signature: "green"
    shape_keyword: "cyan"
    shape_externalarg: "green"
})

# SSH Agent
source login.nu

# Modular configs
source scripts/prompt.nu
source scripts/aliases.nu
source ~/.cache/nushell/zoxide-init.nu
source ~/.cache/nushell/jj-completions.nu

# Custom commands
source scripts/share.nu
source scripts/transcode.nu
source scripts/krc.nu
