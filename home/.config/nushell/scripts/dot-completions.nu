def "nu-complete dot commands" [] {
    [
        "init"
        "sync"
        "update"
        "doctor"
        "check-packages"
        "package"
        "benchmark-shell"
        "link"
        "unlink"
        "completions"
        "help"
    ]
}

def "nu-complete dot package commands" [] {
    ["list", "add", "remove", "help"]
}

def "nu-complete dot package kinds" [] {
    ["brew", "cask"]
}

extern "dot" [
    command?: string@"nu-complete dot commands"
]

extern "dot package" [
    subcommand?: string@"nu-complete dot package commands"
    package?: string
    kind?: string@"nu-complete dot package kinds"
]

extern "dot benchmark-shell" [
    --runs(-r): int
    --verbose(-v)
    --help(-h)
]
