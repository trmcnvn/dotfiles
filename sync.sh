#!/bin/sh

find "$(pwd)/config" -type f -print0 | while IFS= read -r -d '' file; do
  rel_path="${file#$(pwd)/config}"
  mkdir -p "$HOME/.config/$(dirname "$rel_path")"
  ln -sf "$file" "$HOME/.config$rel_path"
done

find "$(pwd)/home" -type f -print0 | while IFS= read -r -d '' file; do
  filename=$(basename "$file")
  ln -sf "$file" "$HOME/$filename"
done
