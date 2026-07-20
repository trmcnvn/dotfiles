alias cl = clear
alias cat = bat
alias vim = nvim
alias vi = nvim
alias ff = fzf --preview 'bat --style=numbers --color=always {}'

def executor-cf-access-client-secret [] {
    let lookup = match (sys host).name {
        "Linux" => {
            if (which secret-tool | is-empty) {
                error make { msg: "Cannot read the Executor credential: secret-tool is not installed" }
            }
            do { ^secret-tool lookup service executor name cf-access-client-secret } | complete
        },
        "Darwin" => {
            do { ^security find-generic-password -s executor -a cf-access-client-secret -w } | complete
        },
        $os => {
            error make { msg: $"Cannot read the Executor credential: unsupported operating system '($os)'" }
        }
    }

    if $lookup.exit_code != 0 {
        error make { msg: "Cannot read the Executor credential. Expected service 'executor' and name/account 'cf-access-client-secret' in the system keyring." }
    }

    let secret = ($lookup.stdout | str trim)
    if ($secret | is-empty) {
        error make { msg: "The Executor credential is empty. Update 'cf-access-client-secret' in the system keyring." }
    }

    $secret
}

def --wrapped pi [...args] {
    with-env { EXECUTOR_CF_ACCESS_CLIENT_SECRET: (executor-cf-access-client-secret) } {
        ^pi ...$args
    }
}
