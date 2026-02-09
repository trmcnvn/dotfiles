# Scaffold a temporary/experimental project via try.rb
def --env try [...args: string] {
    let script_path = "/home/trmcnvn/.local/try.rb"
    let result = (do { /usr/bin/env ruby $script_path cd --path "/home/trmcnvn/code/tries" ...$args } | complete)

    if $result.exit_code == 0 {
        # try.rb outputs a `cd /path` command; extract the path and cd in this shell
        let output = ($result.stdout | str trim)
        if ($output starts-with "cd ") {
            cd ($output | str replace "cd " "")
        } else {
            print $output
        }
    } else {
        print $result.stderr
    }
}
