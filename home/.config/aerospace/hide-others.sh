#!/bin/sh
# Hide every app with a window on the focused workspace, other than the focused
# app (like macOS "Hide Others", scoped to the workspace). Run from
# on-focus-changed in aerospace.toml; needs automatically-unhide-macos-hidden-apps = false.
# Pass --dry-run to print the app PIDs instead of hiding them.

aerospace=/opt/homebrew/bin/aerospace

focused_pid=$("$aerospace" list-windows --focused --format '%{app-pid}' 2>/dev/null)
[ -n "$focused_pid" ] || exit 0

pids=$("$aerospace" list-windows --workspace focused --format '%{app-pid}' |
  grep -vx "$focused_pid" | sort -u | paste -sd, -)
[ -n "$pids" ] || exit 0

if [ "$1" = "--dry-run" ]; then
  echo "$pids"
  exit 0
fi

osascript -l JavaScript -e "ObjC.import('AppKit');
[$pids].forEach(function (pid) {
  var app = \$.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  if (app) app.hide;
});" >/dev/null
