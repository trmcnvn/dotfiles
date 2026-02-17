# Open a tmux layout with editor, AI pane, and terminal
def tml [ai: string] {
    let current_dir = (pwd)

    if ($env | get -o TMUX | is-empty) {
        print "tml: must be run inside an existing tmux session"
        return
    }

    let editor_pane = (tmux display-message -p '#{pane_id}' | str trim)

    # Split window vertically - top 80%, bottom 20%
    tmux split-window -v -p 20 -c $current_dir

    # Go back to top pane and split it horizontally
    tmux select-pane -t $editor_pane
    tmux split-window -h -p 30 -c $current_dir

    # After horizontal split, cursor is in the right pane - run ai there
    let ai_pane = (tmux display-message -p '#{pane_id}' | str trim)
    tmux send-keys -t $ai_pane $ai C-m

    # Run editor in the left pane
    tmux send-keys -t $editor_pane $"($env.EDITOR)" C-m

    # Focus the editor pane
    tmux select-pane -t $editor_pane
}
