set -gx RUST_WITHOUT rust-docs
set -gx CARGO_HOME $XDG_DATA_HOME/cargo
fish_add_path $CARGO_HOME/bin
