# Transcode video using ffmpeg
def transcode-video [
    resolution: string  # "1080" or "4k"
    input: path         # input file
] {
    if (which ffmpeg | is-empty) {
        error make { msg: "ffmpeg not found" }
    }

    let stem = ($input | path parse | get stem)

    match $resolution {
        "1080" => {
            (ffmpeg -i $input
                -vf scale=1920:1080
                -c:v libx264 -preset fast -crf 23
                -c:a copy
                $"($stem)-1080p.mp4")
        },
        "4k" => {
            (ffmpeg -i $input
                -vf scale=3840:2160
                -c:v libx265 -preset slow -crf 24
                -c:a aac -b:a 192k
                $"($stem)-4k.mp4")
        },
        _ => {
            error make { msg: $"Invalid resolution: ($resolution). Use '1080' or '4k'" }
        }
    }
}
