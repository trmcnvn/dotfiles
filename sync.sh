#!/bin/sh

find "$(pwd)/config" -type f -print0 | while IFS= read -r -d '' file; do
  rel_path="${file#$(pwd)/config}"
  mkdir -p "$HOME/.config/$(dirname "$rel_path")"
  ln -sf "$file" "$HOME/.config$rel_path"
done

find "$(pwd)/home" -type f -print0 | while IFS= read -r -d '' file; do
  rel_path="${file#$(pwd)/home}"
  mkdir -p "$HOME/$(dirname "$rel_path")"
  ln -sf "$file" "$HOME$rel_path"
done
