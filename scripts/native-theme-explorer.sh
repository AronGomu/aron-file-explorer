#!/usr/bin/env bash
# Sourced only inside capture-native-theme.sh's fixture-only namespace.
set -euo pipefail
[[ "$NATIVE_CAPTURE_SANDBOX" = 1 && "$HOME" = /fixture/home && "$PWD" = /fixture/cwd ]]
settings=/fixture/cwd/config/settings.json
mkdir -p /fixture/home/Documents/Projects
for name in 01-image.png 02-video.mp4 03-audio.mp3 04-code.js 05-archive.zip 06-document.pdf 07-notes.txt; do
  printf 'Synthetic explorer filename fixture; not a media playback fixture.\n' > "/fixture/home/Documents/$name"
done
for ((i=0; i<100; i++)); do
  printf -v name 'sample-%03d.txt' "$i"
  printf 'Synthetic explorer text fixture %s\n' "$i" > "/fixture/home/Documents/$name"
done

capture_explorer() {
  local name="$1" index=2
  while [[ -e "/evidence/$name.png" ]]; do name="$1-$index"; index=$((index + 1)); done
  sleep 0.5
  kill -0 "$app_pid"
  magick import -window root "/evidence/$name.png"
  cp "$settings" "/evidence/$name.settings.json"
  printf '%s\n' "$name" >> /evidence/explorer-steps.txt
}
focus_explorer() {
  local windows window
  windows=$(xdotool search --onlyvisible --name '^Explr$')
  read -r window <<< "$windows"
  [[ "$window" =~ ^[0-9]+$ ]]
  xdotool windowfocus --sync "$window"
}
settings_palette() {
  focus_explorer
  # Focus existing active view control: xterm owns Ctrl+Comma; Sidebar Settings clears currentPath.
  # Clicking the already-active mode neither navigates nor reloads the directory.
  case "$(jq -r '.default_view' "$settings")" in
    grid) xdotool mousemove 1004 111 click 1 ;;
    list) xdotool mousemove 1042 111 click 1 ;;
    details) xdotool mousemove 1078 111 click 1 ;;
    *) printf 'Unexpected fixture view mode\n' >&2; return 1 ;;
  esac
  xdotool key --clearmodifiers ctrl+comma
  sleep 1
  xdotool mousemove 530 205 click 1
  sleep 0.3
  xdotool key Home
  for ((j=0; j<$1; j++)); do xdotool key Down; done
  xdotool key Return
  sleep 1
  jq -e --arg id "$2" '.active_theme_id == $id' "$settings"
  capture_explorer "$2-settings"
  xdotool mousemove 984 81 click 1
  sleep 1
}
pty_identity() {
  local command pid="" args stat
  for command in /proc/[0-9]*/cmdline; do
    mapfile -d '' -t args < "$command"
    if [[ "${args[0]:-}" = /bin/sh && "${args[1]:-}" = -i ]]; then
      test -z "$pid"
      pid=${command#/proc/}; pid=${pid%/cmdline}
    fi
  done
  [[ "$pid" =~ ^[0-9]+$ ]]
  printf '%s\n' "$pid" > "/evidence/$1.pty-pid"
  readlink "/proc/$pid/cwd" > "/evidence/$1.pty-cwd"
  read -ra stat < "/proc/$pid/stat"
  printf '%s\n' "${stat[21]}" > "/evidence/$1.pty-starttime"
  cat "/proc/$pid/stat" > "/evidence/$1.pty-stat"
  if [[ "$1" != state-before ]]; then
    for field in pid cwd starttime; do cmp "/evidence/state-before.pty-$field" "/evidence/$1.pty-$field"; done
  fi
}

focus_explorer
# Actual breadcrumb editing, synthetic path only.
xdotool mousemove 800 62 click 1
xdotool key --clearmodifiers ctrl+a
xdotool type --clearmodifiers '/fixture/home/Documents'
xdotool key Return
sleep 2
settings_palette 1 catppuccin-latte
# Preserve two actual tabs; existing tab creation behavior remains unchanged.
xdotool mousemove 270 20 click 1
sleep 0.5
for palette in catppuccin-latte catppuccin-mocha; do
  if [[ "$palette" = catppuccin-mocha ]]; then settings_palette 2 "$palette"; fi
  # Existing drive navigation, confined to adapter's read-only mount namespace.
  xdotool mousemove 120 350 click 1
  sleep 2
  capture_explorer "$palette-active-sidebar-capacity"
  xdotool mousemove 800 62 click 1
  xdotool key --clearmodifiers ctrl+a
  xdotool type --clearmodifiers '/fixture/home/Documents'
  xdotool key Return
  sleep 2
  xdotool mousemove 1004 111 click 1
  sleep 0.5
  jq -e '.default_view == "grid"' "$settings"
  capture_explorer "$palette-grid-tabs-breadcrumb"
  xdotool mousemove 253 300 click 1
  xdotool mousemove 480 220 click 1
  capture_explorer "$palette-grid-selected"
  xdotool click 3
  capture_explorer "$palette-context-menu"
  # Actual context-menu Cut; no clipboard or class injection.
  xdotool mousemove 540 322 click 1
  capture_explorer "$palette-grid-selected-cut"
  # Actual Copy clears cut state without moving fixture files.
  xdotool mousemove 480 220 click 3
  sleep 0.5
  xdotool mousemove 540 284 click 1
  xdotool mousemove 1042 111 click 1
  sleep 0.5
  jq -e '.default_view == "list"' "$settings"
  xdotool mousemove 253 300 click 1
  xdotool mousemove 480 220 click 1
  xdotool mousemove 700 85
  capture_explorer "$palette-list"
  xdotool mousemove 1078 111 click 1
  sleep 0.5
  jq -e '.default_view == "details"' "$settings"
  xdotool mousemove 253 300 click 1
  xdotool mousemove 480 270 click 1
  xdotool mousemove 700 85
  capture_explorer "$palette-details"
  # Keyboard focus on actual view controls (mouse-only tab/menu/item contracts unchanged).
  xdotool key Tab
  capture_explorer "$palette-keyboard-focus"
done

# Real file selection + nonzero wheel scroll + unsubmitted real PTY draft.
xdotool mousemove 1042 111 click 1
sleep 0.5
xdotool key --clearmodifiers ctrl+grave
sleep 1
xdotool type --clearmodifiers 't4-draft-kept'
sleep 1
capture_explorer scroll-before
xdotool mousemove 650 380 click --repeat 8 --delay 80 5
sleep 1
xdotool mousemove 470 230 click 1
capture_explorer state-before
pty_identity state-before
for palette in catppuccin-latte catppuccin-mocha; do
  index=1
  if [[ "$palette" = catppuccin-mocha ]]; then index=2; fi
  settings_palette "$index" "$palette"
  capture_explorer "state-after-$palette"
  pty_identity "state-after-$palette"
done
printf '%s\n' \
  'native=extracted-debug-deb; no OS install' \
  'grid/list/details=actual controls + settings.default_view assertions' \
  'tabs/breadcrumb/menu/focus=actual UI; screenshots require review' \
  'selection/scroll/draft=screenshot and OCR/pixel verification required, not inferred from exit' \
  'PTY=PID/starttime/cwd byte-equal across both palettes' \
  'ThisPC=unverified; no production UI dispatch for open-this-pc' \
  'mouse-only-tab/menu/ThisPC-item-keyboard-focus=unreachable without out-of-scope UX change' \
  > /evidence/explorer-result.txt
