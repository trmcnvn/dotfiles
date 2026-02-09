# Cross-platform notification helper
def _notify [title: string, message: string] {
    match (sys host).name {
        "Darwin" => {
            terminal-notifier -message $message -title $title -sound Crystal
        },
        "Linux" => {
            notify-send $title $message
        },
        _ => {
            print $"($title): ($message)"
        }
    }
}

# Pomodoro work timer (50 minutes)
def work [name: string] {
    timer -n $name 50m
    _notify "Work Timer is up! Take a Break" "Work is over! Take a break"
}

# Pomodoro break timer (10 minutes)
def rest [] {
    timer -n "break time" 10m
    _notify "Break is over! Get back to work" "Break is over!"
}
