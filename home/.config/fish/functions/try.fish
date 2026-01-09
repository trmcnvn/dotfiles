function try
    set script_path '/home/trmcnvn/.local/try.rb'
    set cmd (/usr/bin/env ruby "$script_path" cd --path "/home/trmcnvn/code/tries" $argv 2>/dev/tty)
    if test $status -eq 0
        # Execute the command using bash since the ruby script is designed for bash
        bash -c "$cmd"
    else
        echo "$cmd"
    end
end
