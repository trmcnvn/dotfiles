function __ssh_agent_is_started -d "check if ssh agent is already started"
    if begin; test -f $SSH_ENV; and test -z "$SSH_AGENT_PID"; end
        source $SSH_ENV > /dev/null
    end

    if begin; test -z "$SSH_AGENT_PID"; and test -z "$SSH_CONNECTION"; end
        return 1
    end

    # Verify the agent process is still running
    if test -n "$SSH_AGENT_PID"
        if not kill -0 $SSH_AGENT_PID 2>/dev/null
            return 1
        end
    end

    ssh-add -l > /dev/null 2>&1
    if test $status -eq 2
        return 1
    end
end


function __ssh_agent_start -d "start a new ssh agent"
   ssh-agent -c | sed 's/^echo/#echo/' > $SSH_ENV
   chmod 600 $SSH_ENV
   source $SSH_ENV > /dev/null
end


function fish_ssh_agent --description "Start ssh-agent if not started yet, or uses already started ssh-agent."
   if test -z "$SSH_ENV"
      set -xg SSH_ENV $HOME/.ssh/environment
   end

   if not __ssh_agent_is_started
      __ssh_agent_start
   end
end
