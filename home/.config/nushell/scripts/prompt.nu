# JJ-aware prompt matching hydro-jj layout and colors

const COLOR_PWD = "#ebbcba"
const COLOR_ERROR = "#eb6f92"
const COLOR_DURATION = "#c4a7e7"
const COLOR_DIM = { fg: "#ebbcba", attr: d }

def _jj-status [] {
    if (which jj-prompt | is-empty) {
        return {}
    }

    try {
        jj-prompt
    } catch {
        {}
    }
}

def _jj-format [] {
    if (which jj-prompt | is-empty) {
        return ""
    }

    try {
        jj-prompt format
    } catch {
        ""
    }
}

def format-pwd [] {
    let home = ($env.HOME? | default "")
    let pwd = ($env.PWD | str replace $home "~")

    let jj_base = (do {
        let status = (_jj-status)
        let repo_root = ($status | get -o repo_root | default "")
        if ($repo_root | is-empty) {
            ""
        } else {
            $repo_root | str replace $home "~" | split row "/" | last
        }
    })

    let parts = ($pwd | split row "/")
    let last_idx = (($parts | length) - 1)

    $parts | enumerate | each {|it|
        let is_last = ($it.index == $last_idx)
        let is_jj_root = ($it.item == $jj_base and $jj_base != "")

        let sep = if $it.index > 0 {
            $"(ansi $COLOR_DIM)/(ansi reset)"
        } else {
            ""
        }

        let segment = if $is_last or $is_jj_root {
            $it.item
        } else if ($it.item | str starts-with ".") {
            $it.item | str substring 0..1
        } else if ($it.item == "~") {
            "~"
        } else {
            $it.item | str substring 0..0
        }

        $"($sep)(ansi $COLOR_PWD)($segment)(ansi reset)"
    } | str join
}

def format-duration [] {
    let ms = ($env.CMD_DURATION_MS? | default "0" | into int)
    if $ms < 1000 { return "" }

    let total_secs = ($ms / 1000)
    let hours = ($total_secs / 3600 | math floor)
    let mins = (($total_secs / 60 | math floor) mod 60)
    let secs = (($total_secs mod 60 * 10 | math round) / 10)

    mut out = []
    if $hours > 0 { $out = ($out | append $"($hours)h") }
    if $mins > 0 { $out = ($out | append $"($mins)m") }
    if $secs > 0 { $out = ($out | append $"($secs)s") }

    $" (ansi $COLOR_DURATION)($out | str join ' ')(ansi reset)"
}

$env.PROMPT_COMMAND = {||
    let pwd = (format-pwd)
    let jj = (_jj-format)
    let dur = (format-duration)
    let parts = ([$pwd $jj $dur] | where { $in != "" and ($in | is-not-empty) } | str join " ")

    $"($parts)\n"
}

$env.PROMPT_COMMAND_RIGHT = {||
    let code = ($env.LAST_EXIT_CODE? | default 0)
    if $code != 0 {
        $"(ansi $COLOR_ERROR)| ($code)(ansi reset)"
    } else {
        ""
    }
}

$env.PROMPT_INDICATOR = {||
    let code = ($env.LAST_EXIT_CODE? | default 0)
    if $code != 0 {
        $"(ansi $COLOR_ERROR)❯❯❯(ansi reset) "
    } else {
        $"("❯❯❯" | ansi gradient --fgstart '0xa5d6a7' --fgend '0xffab91') "
    }
}

$env.PROMPT_INDICATOR_VI_INSERT = $env.PROMPT_INDICATOR
$env.PROMPT_INDICATOR_VI_NORMAL = $env.PROMPT_INDICATOR

$env.PROMPT_MULTILINE_INDICATOR = {|| "  " }
