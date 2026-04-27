def format-pwd [] {
    let home = ($env.HOME? | default "")
    $env.PWD | str replace $home "~"
}

def color [hex: string, text: string] {
    $"(ansi {fg: $hex})($text)(ansi reset)"
}

def format-jj [] {
    if (which jj-prompt | is-empty) {
        return ""
    }

    let bookmarks = (try { jj-prompt | get -o bookmarks | default [] } catch { [] })

    if ($bookmarks | is-empty) {
        return ""
    }

    let bm = ($bookmarks | first)
    let label = (color "#576d74" "jj")
    let name = (color "#268bd3" $bm.name)
    let distance = (color "#29a298" $"+($bm.distance)")

    $"($label):(ansi reset)($name)($distance)"
}

$env.PROMPT_COMMAND = {||
    let pwd = (format-pwd)
    let jj = (format-jj)
    let suffix = if ($jj | is-empty) { "" } else { $" (color "#576d74" "on") ($jj)" }

    let path = (color "#29a298" $pwd)

    $"($path)($suffix)\n"
}

$env.PROMPT_COMMAND_RIGHT = {|| "" }

$env.PROMPT_INDICATOR = {|| $"(ansi {fg: '#ca4b16'})❯(ansi reset) " }
$env.PROMPT_INDICATOR_VI_INSERT = $env.PROMPT_INDICATOR
$env.PROMPT_INDICATOR_VI_NORMAL = {|| $"(ansi {fg: '#b28500'})❮(ansi reset) " }

$env.PROMPT_MULTILINE_INDICATOR = {|| $"(ansi {fg: '#576d74'})··(ansi reset) " }
