# Login shell setup -- sourced once per login session

# SSH Agent: start if not already running
def --env _start_ssh_agent [] {
    let env_file = ($env.HOME | path join ".ssh" "agent.json")

    # Restore saved agent env if file exists
    if ($env_file | path exists) {
        let saved = (try { open $env_file } catch { {} })
        let saved_sock = ($saved | get -o SSH_AUTH_SOCK | default "")
        let saved_pid = ($saved | get -o SSH_AGENT_PID | default "")

        if ($saved_sock | is-not-empty) {
            $env.SSH_AUTH_SOCK = $saved_sock
        }

        if ($saved_pid | is-not-empty) {
            $env.SSH_AGENT_PID = $saved_pid
        }
    }

    # Check if agent is alive
    let agent_running = if ($env | get -o SSH_AGENT_PID | is-not-empty) {
        let pid = (try { $env.SSH_AGENT_PID | into int } catch { -1 })
        if $pid > 0 {
            (do { ^kill -0 $pid } | complete).exit_code == 0
        } else {
            false
        }
    } else {
        false
    }

    if not $agent_running {
        # Start new agent, parse output into env vars
        let agent_output = (ssh-agent -s | lines | where { |l| $l starts-with "SSH_" })

        for line in $agent_output {
            let parts = ($line | split row ";" | first | split row "=")
            let key = ($parts | first)
            let val = ($parts | last)

            if $key == "SSH_AUTH_SOCK" {
                $env.SSH_AUTH_SOCK = $val
            } else if $key == "SSH_AGENT_PID" {
                $env.SSH_AGENT_PID = $val
            }
        }

        # Persist as JSON for future shells
        { SSH_AUTH_SOCK: $env.SSH_AUTH_SOCK, SSH_AGENT_PID: $env.SSH_AGENT_PID }
            | to json
            | save --force $env_file
        chmod 600 $env_file
    }
}

_start_ssh_agent
