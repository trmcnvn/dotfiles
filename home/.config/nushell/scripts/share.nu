# Upload a file to https://0x0.st and copy URL to clipboard
def share [file: path] {
    if not ($file | path exists) {
        error make { msg: $"File not found: ($file)" }
    }

    let upload = (do { curl -fsS -F $"file=@($file)" -Fexpires=1 https://0x0.st } | complete)
    if $upload.exit_code != 0 {
        error make { msg: $"Upload failed: ($upload.stderr | str trim)" }
    }

    let url = ($upload.stdout | str trim)
    if not ($url | str starts-with "https://0x0.st/") {
        error make { msg: $"Unexpected upload response: ($url)" }
    }

    match (sys host).name {
        "Linux" => {
            if (which xclip | is-not-empty) {
                $url | xclip -selection clipboard
            }
        },
        "Darwin" => {
            if (which pbcopy | is-not-empty) {
                $url | pbcopy
            }
        },
        _ => {}
    }

    print $"> Uploaded ($file) at ($url) \(copied to clipboard)"
}
