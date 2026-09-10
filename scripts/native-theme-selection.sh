#!/usr/bin/env bash
# Sourced only inside capture-native-theme.sh's fixture-only namespace.
set -euo pipefail
[[ "$NATIVE_CAPTURE_SANDBOX" = 1 && "$HOME" = /fixture/home && "$PWD" = /fixture/cwd ]]
settings=/fixture/cwd/config/settings.json
themes=/fixture/config/com.explr.app/themes

capture_step() {
  magick import -window root "/evidence/$1.png"
  cp "$settings" "/evidence/$1.settings.json"
  printf '%s\n' "$1" >> /evidence/selection-steps.txt
  if [[ "$1" = state-* ]]; then
    local command pid="" args
    for command in /proc/[0-9]*/cmdline; do
      mapfile -d '' -t args < "$command"
      if [[ "${args[0]:-}" = /bin/sh && "${args[1]:-}" = -i ]]; then
        test -z "$pid"
        pid=${command#/proc/}
        pid=${pid%/cmdline}
      fi
    done
    [[ "$pid" =~ ^[0-9]+$ ]]
    printf '%s\n' "$pid" > "/evidence/$1.pty-pid"
    readlink "/proc/$pid/cwd" > "/evidence/$1.pty-cwd"
    readlink "/proc/$pid/exe" > "/evidence/$1.pty-exe"
    cat "/proc/$pid/stat" > "/evidence/$1.pty-stat"
    if [[ "$1" != state-before ]]; then
      cmp /evidence/state-before.pty-pid "/evidence/$1.pty-pid"
      cmp /evidence/state-before.pty-cwd "/evidence/$1.pty-cwd"
    fi
  fi
}
focus_app() {
  local windows
  windows=$(xdotool search --onlyvisible --name '^Explr$')
  read -r window <<< "$windows"
  [[ "$window" =~ ^[0-9]+$ ]]
  xdotool windowfocus --sync "$window"
}
open_settings() {
  focus_app
  # Actual sidebar Settings control; focused xterm consumes Ctrl+Comma.
  xdotool mousemove 75 706 click 1
  sleep 1
}
select_index() {
  # Fixed 1200x800 fixture viewport; click the actual production select, not an IPC hook.
  xdotool mousemove 530 205 click 1
  sleep 0.4
  magick import -window root /evidence/select-menu-open.png
  xdotool key Home
  for ((i=0; i<$1; i++)); do xdotool key Down; done
  sleep 0.3
  magick import -window root /evidence/select-menu-choice.png
  xdotool key Return
  sleep 1
}
stop_app() {
  kill "$app_pid"
  set +e
  wait "$app_pid"
  status=$?
  set -e
  [[ "$status" = 143 || "$status" = 0 ]]
  printf '%s\n' "$status" >> /evidence/selection-stop.status
  app_pid=""
}
restart_app() {
  "$NATIVE_CAPTURE_BINARY" >> /evidence/app.stdout.log 2>> /evidence/app.stderr.log &
  app_pid=$!
  for ((attempt=0; attempt<150; attempt++)); do
    kill -0 "$app_pid"
    xwininfo -root -tree > /evidence/selection-windows.txt
    if grep -q '"Explr"' /evidence/selection-windows.txt; then break; fi
    sleep 0.2
  done
  sleep 5
  kill -0 "$app_pid"
  open_settings
}

jq -e '.active_theme_id == "system"' "$settings"
cp "$themes/.seed-state.json" /evidence/seed-state.json
cp "$themes/theme.schema.json" /evidence/seed-schema.json
cp "$themes/catppuccin-latte.theme.json" /evidence/seed-latte.json
cp "$themes/catppuccin-mocha.theme.json" /evidence/seed-mocha.json
focus_app
xdotool mousemove 270 20 click 1
sleep 1
xdotool mousemove 646 220 click 1
xdotool key --clearmodifiers ctrl+grave
sleep 1
xdotool type --clearmodifiers 'theme-state-kept'
# PTY echo reaches xterm asynchronously; capture only after rendered draft settles.
sleep 1
capture_step state-before
open_settings
capture_step fresh-system
select_index 1
capture_step selected-latte
jq -e '.active_theme_id == "catppuccin-latte"' "$settings"
xdotool mousemove 984 81 click 1
sleep 1
capture_step state-after-latte
open_settings
select_index 2
capture_step selected-mocha
jq -e '.active_theme_id == "catppuccin-mocha"' "$settings"
xdotool mousemove 984 81 click 1
sleep 1
capture_step state-after-mocha
open_settings
select_index 0
capture_step selected-system
jq -e '.active_theme_id == "system"' "$settings"
xdotool mousemove 984 81 click 1
sleep 1
capture_step state-after-system
stop_app
restart_app
capture_step restarted-system
jq -e '.active_theme_id == "system"' "$settings"
select_index 2
capture_step reselected-mocha
jq -e '.active_theme_id == "catppuccin-mocha"' "$settings"

# Deny atomic temp creation; the running process must keep both disk and visible Mocha.
chmod 500 /fixture/cwd/config
xdotool key Escape
open_settings
select_index 1
capture_step failed-save
chmod 700 /fixture/cwd/config
cmp /evidence/selected-mocha.settings.json /evidence/failed-save.settings.json
stop_app
restart_app
capture_step restarted-mocha
jq -e '.active_theme_id == "catppuccin-mocha"' "$settings"

stop_app
jq '.name = "Edited Mocha" | .tokens.background = "#203040" | .tokens.surface = "#203040"' "$themes/catppuccin-mocha.theme.json" > /fixture/edited.theme.json
cp /fixture/edited.theme.json "$themes/catppuccin-mocha.theme.json"
restart_app
capture_step restarted-edited
cmp /fixture/edited.theme.json "$themes/catppuccin-mocha.theme.json"
cp "$themes/catppuccin-mocha.theme.json" /evidence/edited-mocha.json
cmp /evidence/seed-state.json "$themes/.seed-state.json"

stop_app
jq '.id = "custom-dusk" | .name = "Custom Dusk" | .tokens.background = "#304050" | .tokens.surface = "#304050"' /evidence/seed-mocha.json > "$themes/custom-dusk.theme.json"
cp "$themes/custom-dusk.theme.json" /evidence/custom-dusk.json
restart_app
capture_step restarted-custom-available
select_index 3
capture_step selected-custom
jq -e '.active_theme_id == "custom-dusk"' "$settings"
stop_app
restart_app
capture_step restarted-custom
jq -e '.active_theme_id == "custom-dusk"' "$settings"
cmp /evidence/custom-dusk.json "$themes/custom-dusk.theme.json"

stop_app
jq 'del(.active_theme_id) | .darkmode = true | .custom_themes = ["old"] | .default_theme = "old" | .default_themes_path = "old" | .accent_color = "#000000" | .unrelated = {nested: ["keep", 17]} | .backend_settings.logging_config.extra = {keep:true}' "$settings" > /fixture/legacy.settings.json
cp /fixture/legacy.settings.json "$settings"
cp "$settings" /evidence/legacy-before.json
restart_app
capture_step migrated-system
jq -e '.active_theme_id == "system" and (has("darkmode") | not) and (has("custom_themes") | not) and (has("default_theme") | not) and (has("default_themes_path") | not) and (has("accent_color") | not) and .unrelated.nested == ["keep",17] and .backend_settings.logging_config.extra.keep == true' "$settings"
printf 'real-IPC=UI-select-to-settings-file\nrestart=persisted-id-including-explicit-System\ncustom=startup-discovery-UI-activation-restart\nexternal-edit=restart-only\nfailed-save=denied-directory-original-bytes\nlegacy-migration=raw-extras-preserved\n' > /evidence/selection-result.txt
