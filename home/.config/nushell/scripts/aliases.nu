alias cl = clear
alias cat = bat
alias vim = nvim
alias vi = nvim
alias ff = fzf --preview 'bat --style=numbers --color=always {}'

def --wrapped op2 [...args] {
    with-env { EXECUTOR_CF_ACCESS_CLIENT_SECRET: (^secret-tool lookup service executor name cf-access-client-secret) } {
        ^/home/trmcnvn/Code/opencode-v2/packages/cli/dist/cli-linux-x64/bin/opencode2 ...$args
    }
}

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
