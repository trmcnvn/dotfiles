# Upload a file to https://0x0.st and copy URL to clipboard
def share [file: path] {
    let url = (curl -sF $"file=@($file)" -Fexpires=1 https://0x0.st | str trim)

    match (sys host).name {
        "Linux" => { $url | xclip -selection clipboard },
        "Darwin" => { $url | pbcopy },
        _ => {}
    }

    print $"> Uploaded ($file) at ($url) \(copied to clipboard)"
}
