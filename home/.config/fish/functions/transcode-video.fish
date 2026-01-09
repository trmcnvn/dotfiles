function __transcode_1080
    set -l in $argv[1]
    set -l name (basename "$in")
    set -l stem (string split -r -m1 . $name)[1]
    ffmpeg -i "$in" -vf scale=1920:1080 -c:v libx264 -preset fast -crf 23 -c:a copy "$stem-1080p.mp4"
end

function __transcode_4k
    set -l in $argv[1]
    set -l name (basename "$in")
    set -l stem (string split -r -m1 . $name)[1]
    ffmpeg -i "$in" -c:v libx265 -preset slow -crf 24 -c:a aac -b:a 192k "$stem-4k.mp4"
end

function transcode-video
    if not type -q ffmpeg
        echo "ffmpeg not found"
        return 1
    end

    if test (count $argv) -eq 0
        echo "Usage: transcode-video <1080|4k> <input-file>"
        return 2
    end

    set res $argv[1]
    set -l input $argv[2]

    switch $res
        case 1080
            if test -z "$input"
                echo "Missing input file"
                return 2
            end
            __transcode_1080 $input
        case 4k
            if test -z "$input"
                echo "Missing input file"
                return 2
            end
            __transcode_4k $input
        case '*'
            echo "Invalid resolution: $res"
            echo "Usage: transcode-video <1080|4k> <input-file>"
            return 2
    end
end
