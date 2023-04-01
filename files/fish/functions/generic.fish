function generic
  echo "hello world"
end

function upgrade_wezterm
  brew upgrade --cask wezterm-nightly --no-quarantine --greedy-latest
end
