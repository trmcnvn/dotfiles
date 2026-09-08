def --wrapped pi [...args] {
    let keychain = (
        ^security find-generic-password
            -a $env.USER
            -s agent-memory-api-token
            -w
        | complete
    )

    if $keychain.exit_code != 0 {
        error make { msg: "Could not read the Agent Memory token from macOS Keychain." }
    }

    let token = ($keychain.stdout | str trim)
    if ($token | is-empty) {
        error make { msg: "The Agent Memory token in macOS Keychain is empty." }
    }

    with-env {
        PI_MEMORY_SERVICE_URL: "https://memory.trmcnvn.dev"
        PI_MEMORY_SERVICE_TOKEN: $token
    } {
        ^pi ...$args
    }
}
