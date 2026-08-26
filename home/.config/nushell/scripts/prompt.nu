def format-pwd [] {
    let home = ($env.HOME? | default "")
    $env.PWD | str replace $home "~"
}

def color [hex: string, text: string] {
    $"(ansi {fg: $hex})($text)(ansi reset)"
}

$env.PROMPT_COMMAND = {||
    let pwd = (format-pwd)
    let path = (color "#29a298" $pwd)

    $"($path)\n"
}

$env.PROMPT_COMMAND_RIGHT = {|| "" }

$env.PROMPT_INDICATOR = {|| $"(ansi {fg: '#ca4b16'})❯(ansi reset) " }
$env.PROMPT_INDICATOR_VI_INSERT = $env.PROMPT_INDICATOR
$env.PROMPT_INDICATOR_VI_NORMAL = {|| $"(ansi {fg: '#b28500'})❮(ansi reset) " }

$env.PROMPT_MULTILINE_INDICATOR = {|| $"(ansi {fg: '#576d74'})··(ansi reset) " }
