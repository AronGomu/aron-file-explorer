#!/usr/bin/env bash
# Sourced only inside capture-native-theme.sh's fixture-only namespace.
set -euo pipefail
[[ "$NATIVE_CAPTURE_SANDBOX" = 1 && "$HOME" = /fixture/home && "$PWD" = /fixture/cwd ]]
settings=/fixture/cwd/config/settings.json
printf 'WEBKIT_GST_ALLOWED_URI_PROTOCOLS=%s\n' "${WEBKIT_GST_ALLOWED_URI_PROTOCOLS:-default}" > /evidence/protocol-override.txt
printf 'GST_PLUGIN_SYSTEM_PATH_1_0=%s\nGST_PLUGIN_SCANNER_1_0=%s\nGST_REGISTRY_1_0=%s\n' \
  "$GST_PLUGIN_SYSTEM_PATH_1_0" "$GST_PLUGIN_SCANNER_1_0" "$GST_REGISTRY_1_0" > /evidence/gstreamer-env.txt
for element in appsink playbin vp9parse vp9dec matroskademux; do
  gst-inspect-1.0 "$element" > "/evidence/gstreamer-$element.txt"
done
sha256sum "$GST_PLUGIN_SCANNER_1_0" > /evidence/gstreamer-scanner.sha256
# Decoder diagnostic only; separate from required production WebKit playback screenshots.
gst-launch-1.0 -e filesrc location=/media-fixtures/reference.webm ! matroskademux ! vp9parse ! vp9dec ! videoconvert ! video/x-raw,format=RGB ! filesink location=/evidence/reference.rgb > /evidence/gstreamer-decode.txt 2>&1
for kind in image video pdf text error; do mkdir -p "/fixture/home/media/$kind"; done
cp /media-fixtures/reference.png /fixture/home/media/image/
cp /media-fixtures/reference.webm /fixture/home/media/video/
cp /media-fixtures/reference.pdf /fixture/home/media/pdf/
cp /media-fixtures/reference.txt /fixture/home/media/text/
cp /media-fixtures/reference.txt /fixture/home/media/error/
find /media-fixtures -type f -exec sha256sum {} + | sort > /evidence/media-source.before
find /fixture/home/media -type f -exec sha256sum {} + | sort > /evidence/media-copy.before

peripheral_capture() {
  kill -0 "$app_pid"
  magick import -window root "/evidence/$1.png"
  cp "$settings" "/evidence/$1.settings.json"
  printf '%s\n' "$1" >> /evidence/peripheral-steps.txt
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
    cat "/proc/$pid/stat" > "/evidence/$1.pty-stat"
    readlink "/proc/$pid/exe" > "/evidence/$1.pty-exe"
    sha256sum "/proc/$pid/exe" > "/evidence/$1.pty-exe.sha256"
    local stat fields
    stat=$(< "/proc/$pid/stat")
    read -r -a fields <<< "${stat##*) }"
    printf '%s\n' "${fields[19]}" > "/evidence/$1.pty-starttime"
    if [[ "$1" != state-before ]]; then
      for field in pty-pid pty-cwd pty-starttime pty-exe pty-exe.sha256; do
        cmp "/evidence/state-before.$field" "/evidence/$1.$field"
      done
    fi
  fi
}
peripheral_focus() {
  local windows
  windows=$(xdotool search --onlyvisible --name '^Explr$')
  read -r window <<< "$windows"
  [[ "$window" =~ ^[0-9]+$ ]]
  xdotool windowfocus --sync "$window"
}
peripheral_path() {
  xdotool mousemove 600 61 click 1
  xdotool key --clearmodifiers ctrl+a
  xdotool type --clearmodifiers "$1"
  xdotool key Return
  sleep 1
}
peripheral_theme() {
  peripheral_focus
  # Inert tab-bar space blurs inputs without Sidebar Settings' navigateTo(null).
  xdotool mousemove 1000 20 click 1
  xdotool key --clearmodifiers ctrl+comma
  sleep 1
  xdotool mousemove 530 205 click 1
  xdotool key Home
  for ((i=0; i<$1; i++)); do xdotool key Down; done
  xdotool key Return
  sleep 1
  jq -e --arg id "$2" '.active_theme_id == $id' "$settings"
  xdotool mousemove 984 81 click 1
  sleep 1
}

peripheral_focus
for theme in catppuccin-latte catppuccin-mocha; do
  index=1
  if [[ "$theme" = catppuccin-mocha ]]; then index=2; fi
  peripheral_theme "$index" "$theme"
  for kind in image video pdf text error; do
    peripheral_path "/fixture/home/media/$kind"
    if [[ "$kind" = error ]]; then chmod 000 /fixture/home/media/error/reference.txt; fi
    xdotool mousemove 334 186 click 1
    xdotool key space
    sleep 2
    peripheral_capture "$theme-preview-$kind"
    if [[ "$kind" = pdf ]]; then
      xdotool mousemove 650 160 click 5
      sleep 0.5
      peripheral_capture "$theme-pdf-platform-scroll"
    fi
    if [[ "$kind" = video ]]; then
      # Production native media control; never JS injection or document styling.
      xdotool mousemove 552 435 click 1
      sleep 1
      peripheral_capture "$theme-video-playback"
    fi
    # Pointer dismissal avoids unrelated global key handlers consuming Escape.
    xdotool mousemove 1100 700 click 1
    sleep 0.4
    if [[ "$kind" = error ]]; then chmod 644 /fixture/home/media/error/reference.txt; fi
  done
  peripheral_path /fixture/home/media/text
  xdotool mousemove 334 186 click 1
  xdotool key F2
  sleep 1
  peripheral_capture "$theme-rename"
  xdotool mousemove 1100 700 click 1
  xdotool mousemove 334 186 click 3
  sleep 0.5
  peripheral_capture "$theme-file-context"
  # Open production confirm, cancel via backdrop; no deletion executes.
  xdotool mousemove 400 459 click 1
  sleep 0.5
  peripheral_capture "$theme-confirm"
  xdotool mousemove 1100 700 click 1
  for hash_action in generated file compare; do
    xdotool mousemove 1100 700 click 1
    sleep 0.2
    xdotool mousemove 334 186 click 1
    sleep 0.2
    xdotool mousemove 334 186 click 3
    xdotool mousemove 450 605
    sleep 0.5
    peripheral_capture "$theme-hash-menu-$hash_action"
    case "$hash_action" in
      generated) menu_y=608 ;;
      file) menu_y=646 ;;
      compare) menu_y=694 ;;
    esac
    xdotool mousemove 660 "$menu_y" click 1
    sleep 1
    peripheral_capture "$theme-hash-$hash_action"
    xdotool mousemove 1100 700 click 1
  done
  xdotool mousemove 1170 61 click 1
  sleep 1
  xdotool mousemove 300 175 click 1
  xdotool key --clearmodifiers ctrl+a BackSpace
  xdotool mousemove 20 20
  peripheral_capture "$theme-search"
  for control in search filter; do
    control_x=939
    if [[ "$control" = filter ]]; then control_x=972; fi
    xdotool mousemove "$control_x" 175
    sleep 0.3
    peripheral_capture "$theme-$control-enter"
    xdotool mousemove 20 20
    sleep 0.3
    peripheral_capture "$theme-$control-leave"
  done
  xdotool mousemove 300 175 click 1
  xdotool key Tab
  peripheral_capture "$theme-search-button-focus"
  xdotool mousemove 972 175 click 1
  peripheral_capture "$theme-search-filters-open"
  xdotool mousemove 972 175 click 1
  xdotool mousemove 300 175 click 1
  xdotool type --clearmodifiers 'reference'
  xdotool mousemove 939 175 click 1
  # Bounded ordinary search attempt; screenshots/logs distinguish results from empty UI.
  sleep 8
  peripheral_capture "$theme-search-query-attempt"
  printf 'query=reference\nfolder=/fixture/home/media/text\nwait-seconds=8\nresult=UNVERIFIED-inspect-UI-and-app-log\n' > "/evidence/$theme-search-query.txt"
  xdotool key Escape
  xdotool mousemove 75 738 click 1
  sleep 1
  peripheral_capture "$theme-templates-list"
  # Actual Add Template action, fixture path only.
  xdotool mousemove 1120 111 click 1
  sleep 0.5
  peripheral_capture "$theme-template-add"
  xdotool type --clearmodifiers '/fixture/home/media/text/reference.txt'
  xdotool key Return
  sleep 1
  peripheral_capture "$theme-templates-populated-toast"
  xdotool key Escape
  # Production close-templates control, then reachable sidebar SFTP form.
  xdotool mousemove 393 111 click 1
  sleep 0.5
  xdotool mousemove 220 405 click 1
  sleep 0.5
  peripheral_capture "$theme-sftp-empty"
  # Name/host/port/user fields via ordinary form keyboard navigation; no credentials.
  xdotool key Tab Tab
  xdotool type --clearmodifiers 'Synthetic server'
  xdotool key Tab ctrl+a
  xdotool type --clearmodifiers '127.0.0.1'
  xdotool key Tab Tab
  xdotool type --clearmodifiers 'fixture'
  peripheral_capture "$theme-sftp-form"
  xdotool mousemove 650 638 click 1
  sleep 2
  peripheral_capture "$theme-sftp-failure"
  xdotool key Escape
  sleep 0.5
 done
# Bounded unsubmitted SFTP draft attempt through ordinary UI; no form submission.
xdotool mousemove 220 405 click 1
sleep 0.5
xdotool mousemove 530 250 click 1
xdotool key ctrl+a
xdotool type --clearmodifiers 'Theme draft kept'
xdotool mousemove 530 330 click 1
xdotool key ctrl+a
xdotool type --clearmodifiers '127.0.0.1'
xdotool mousemove 530 485 click 1
xdotool type --clearmodifiers 'fixture-draft'
peripheral_capture form-draft-before
for theme in catppuccin-latte catppuccin-mocha; do
  # Modal header is inert: blur without backdrop dismissal or Sidebar navigation.
  xdotool mousemove 600 150 click 1
  xdotool key --clearmodifiers ctrl+comma
  sleep 1
  peripheral_capture "$theme-form-settings"
  xdotool mousemove 530 205 click 1
  xdotool key Home Down
  if [[ "$theme" = catppuccin-mocha ]]; then xdotool key Down; fi
  xdotool key Return
  sleep 1
  jq -e --arg id "$theme" '.active_theme_id == $id' "$settings"
  # Close only Settings; Escape would also dismiss underlying SFTP modal.
  xdotool mousemove 984 81 click 1
  sleep 0.5
  peripheral_capture "$theme-form-draft-after"
done
printf 'name=Theme draft kept\nhost=127.0.0.1\nport=22\nusername=fixture-draft\npassword=empty\nsubmitted=no\nmethod=modal-header-blur+CtrlComma;Settings-close-button\nresult=UNVERIFIED-inspect-field-screenshots\n' > /evidence/form-draft-attempt.txt
xdotool mousemove 775 159 click 1
sleep 0.5
# Actual navigation/tabs/selection/PTY retention; no production inspection hook.
xdotool mousemove 270 20 click 1
sleep 0.5
peripheral_path /fixture/home/media/text
xdotool mousemove 1100 700 click 1
xdotool mousemove 334 186 click 1
xdotool key --clearmodifiers ctrl+grave
sleep 1
xdotool type --clearmodifiers 'theme-state-kept'
sleep 1
peripheral_capture state-before
peripheral_theme 1 catppuccin-latte
peripheral_capture state-after-latte
peripheral_theme 2 catppuccin-mocha
peripheral_capture state-after-mocha
find /media-fixtures -type f -exec sha256sum {} + | sort > /evidence/media-source.after
find /fixture/home/media -type f -exec sha256sum {} + | sort > /evidence/media-copy.after
cmp /evidence/media-source.before /evidence/media-source.after
cmp /evidence/media-copy.before /evidence/media-copy.after
printf 'media-source=unchanged\nmedia-copy=unchanged\nnetwork=private-netns\ncredentials=none\nplatform-controls=excluded-from-app-color-verdict\nvisual-review=required\n' > /evidence/peripheral-result.txt
if [[ "${WEBKIT_GST_ALLOWED_URI_PROTOCOLS:-}" = asset ]]; then
  printf 'video-environment=CONDITIONAL-ON-TEST-OVERRIDE\ndefault-runtime-video=blocked-by-protocol-allowlist\n' >> /evidence/peripheral-result.txt
fi
if grep -q 'No URI handler implemented for "asset".' /evidence/app.stderr.log; then
  printf 'video-playback=FAILED-no-asset-URI-handler\n' >> /evidence/peripheral-result.txt
elif grep -q 'Requested protocol: asset (allowed: no)' /evidence/app.stderr.log; then
  printf 'video-playback=FAILED-protocol-allowlist\n' >> /evidence/peripheral-result.txt
else
  printf 'video-playback=UNVERIFIED-inspect-rendered-frames-and-timeline\n' >> /evidence/peripheral-result.txt
fi
