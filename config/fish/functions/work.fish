function work
   echo $argv[1]
   timer 60m && terminal-notifier -message "Work is over! Take a break" -title 'Work Timer is up! Take a Break' -sound Crystal
end

function rest
   echo "break time ☕️"
   timer 15m && terminal-notifier -message "Break is over!" -title 'Break is over! Get back to work' -sound Crystal
end
