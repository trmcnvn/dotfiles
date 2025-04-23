function work
   timer -n $argv[1] 60m && terminal-notifier -message "Work is over! Take a break" -title 'Work Timer is up! Take a Break' -sound Crystal
end

function rest
   timer -n "break time ☕️" 15m && terminal-notifier -message "Break is over!" -title 'Break is over! Get back to work' -sound Crystal
end
