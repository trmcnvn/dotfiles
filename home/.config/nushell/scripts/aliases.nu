alias cl = clear
alias cat = bat
alias vim = nvim
alias vi = nvim
alias ff = fzf --preview 'bat --style=numbers --color=always {}'

def --wrapped amp [...args] {
    with-env { EXECUTOR_CF_ACCESS_CLIENT_SECRET: (^secret-tool lookup service executor name cf-access-client-secret) } {
        ^amp ...$args
    }
}

def --wrapped pi [...args] {
    with-env { EXECUTOR_CF_ACCESS_CLIENT_SECRET: (^secret-tool lookup service executor name cf-access-client-secret) } {
        ^pi ...$args
    }
}
