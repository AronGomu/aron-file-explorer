#!/usr/bin/env bash
# Sourced only within capture-native-theme.sh's fixture-only namespace.
set -euo pipefail
[[ "$NATIVE_CAPTURE_SANDBOX" = 1 && "$HOME" = /fixture/home && "$PWD" = /fixture/cwd ]]
trap 'printf "reload-failure line=%s command=%s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR
settings=/fixture/cwd/config/settings.json
themes=/fixture/config/com.explr.app/themes
active="$themes/catppuccin-latte.theme.json"

focus_app() {
  local windows
  windows=$(xdotool search --onlyvisible --name '^Explr$')
  read -r window <<< "$windows"
  [[ "$window" =~ ^[0-9]+$ ]]
  xdotool windowfocus --sync "$window"
}
open_settings() {
  focus_app
  # Inert Favorites heading blurs xterm. Sidebar Settings itself clears navigation.
  xdotool mousemove 65 101 click 1
  xdotool key --clearmodifiers ctrl+comma
  sleep 0.5
}
close_settings() {
  # Footer Close stays reachable when error toasts cover the top-right close button.
  xdotool mousemove 373 714 click 1
  sleep 0.4
}
state_capture() {
  local name=$1 command pid="" args fields
  magick import -window root "/evidence/$name.png"
  cp "$settings" "/evidence/$name.settings.json"
  for command in /proc/[0-9]*/cmdline; do
    mapfile -d '' -t args < "$command"
    if [[ "${args[0]:-}" = /bin/sh && "${args[1]:-}" = -i ]]; then
      test -z "$pid"
      pid=${command#/proc/}; pid=${pid%/cmdline}
    fi
  done
  [[ "$pid" =~ ^[0-9]+$ ]]
  read -r -a fields < "/proc/$pid/stat"
  printf 'pid=%s starttime=%s cwd=%s exe=%s\n' "$pid" "${fields[21]}" "$(readlink "/proc/$pid/cwd")" "$(readlink "/proc/$pid/exe")" > "/evidence/$name.pty.txt"
  if [[ "$name" != state-before ]]; then
    cmp /evidence/state-before.pty.txt "/evidence/$name.pty.txt"
    cmp /evidence/state-before.settings.json "/evidence/$name.settings.json"
  fi
}
pixel() {
  magick import -window root -crop 1x1+700+400 +repage -depth 8 -format '%[hex:p{0,0}]' info:
}
assert_pixel() {
  local actual
  actual=$(pixel)
  printf 'expected=%s actual=%s unix_ms=%s\n' "$1" "$actual" "$(date +%s%3N)" >> /evidence/pixel-assertions.txt
  [[ "$actual" = "$1" ]]
}
timed_save() {
  local label=$1 color=$2 before after detected actual
  jq --arg color "#$color" '.tokens.background = $color' /evidence/seed-latte.json > "$themes/.editor.tmp"
  before=$(date +%s%3N)
  mv "$themes/.editor.tmp" "$active"
  after=$(date +%s%3N)
  for ((attempt=0; attempt<30; attempt++)); do
    actual=$(pixel)
    detected=$(date +%s%3N)
    printf '%s,%s,%s\n' "$label" "$detected" "$actual" >> /evidence/pixel-samples.csv
    [[ "$actual" = "$color" ]] && break
    sleep 0.01
  done
  [[ "$actual" = "$color" ]]
  printf '%s,%s,%s,%s,%s\n' "$label" "$before" "$after" "$detected" "$((detected-before))" >> /evidence/reload-timing.csv
  # Conservative upper bound includes rename syscall and capture overhead.
  (( detected-before <= 500 ))
  cp "$active" "/evidence/$label.theme.json"
}

cp "$active" /evidence/seed-latte.json
cp "$themes/catppuccin-mocha.theme.json" /evidence/seed-mocha.json
cp "$themes/.seed-state.json" /evidence/seed-state.json
cp "$themes/theme.schema.json" /evidence/seed-schema.json
open_settings
xdotool mousemove 530 205 click 1
xdotool key Home Down Return
sleep 0.5
jq -e '.active_theme_id == "catppuccin-latte"' "$settings"
close_settings
focus_app
xdotool mousemove 270 20 click 1
sleep 0.4
xdotool mousemove 646 220 click 1
xdotool key --clearmodifiers ctrl+grave
sleep 0.6
xdotool type --clearmodifiers 'reload-draft-kept'
sleep 0.5
state_capture state-before
assert_pixel EFF1F5
printf 'scenario,rename_before_ms,rename_after_ms,pixel_detected_ms,upper_bound_ms\n' > /evidence/reload-timing.csv
printf 'scenario,unix_ms,pixel_hex\n' > /evidence/pixel-samples.csv

timed_save valid 203040
state_capture state-valid
printf '{bad one' > "$active"
sleep 0.4
assert_pixel 203040
state_capture state-invalid
printf '{bad two' > "$active"
sleep 0.4
state_capture state-invalid-changed
# Repeated exact rejected state must not generate another catalog event.
cp /evidence/app.stderr.log /evidence/before-identical.log
printf '{bad two' > "$active"
sleep 0.4
cp /evidence/app.stderr.log /evidence/after-identical.log
cmp /evidence/before-identical.log /evidence/after-identical.log

timed_save recovery 304050
state_capture state-recovery
jq '.id = "custom-copy" | .name = "Custom Copy"' /evidence/seed-mocha.json > "$themes/copy.theme.json"
sleep 0.4
assert_pixel 304050
open_settings
xdotool mousemove 530 205 click 1
sleep 0.2
magick import -window root /evidence/copy-available.png
xdotool key Escape
close_settings
state_capture state-copy
cp "$active" "$themes/duplicate.theme.json"
sleep 0.4
state_capture state-duplicate
rm "$themes/duplicate.theme.json"
mv "$active" "$themes/renamed.theme.json"
active="$themes/renamed.theme.json"
sleep 0.4
assert_pixel 304050
state_capture state-renamed
rm "$active"
sleep 0.4
assert_pixel 304050
open_settings
magick import -window root /evidence/deleted-unavailable.png
close_settings
state_capture state-deleted

# Live lifecycle recovery must not seed even if the entire directory disappeared.
mv "$themes" /fixture/removed-themes
sleep 0.4
mkdir "$themes"
sleep 0.4
test ! -e "$themes/catppuccin-latte.theme.json"
test ! -e "$themes/catppuccin-mocha.theme.json"
test ! -e "$themes/.seed-state.json"
test ! -e "$themes/theme.schema.json"
cp /evidence/recovery.theme.json "$themes/restored.theme.json"
sleep 0.4
assert_pixel 304050
state_capture state-directory-recreated
find "$themes" -type f -printf '%f\n' > /evidence/recreated-files.txt
cmp /evidence/seed-state.json /fixture/removed-themes/.seed-state.json

# Cold-start missing selection keeps seed ledger/user bytes; no watcher/provider test hook.
cp /evidence/seed-state.json "$themes/.seed-state.json"
cp /evidence/seed-schema.json "$themes/theme.schema.json"
rm "$themes/restored.theme.json"
sleep 0.4
focus_app
# Bare Xvfb has no WM to service _NET_CLOSE_WINDOW. Inspect WM_PROTOCOLS,
# then send one standard WM_DELETE_WINDOW client message directly to this window.
if python3 - "$window" "$NATIVE_X11_LIBRARY" > /evidence/wm-delete.json <<'PYX'
import ctypes as c
import json
import sys
import time
x = c.CDLL(sys.argv[2])
Window = Atom = c.c_ulong
Display = c.c_void_p
x.XOpenDisplay.argtypes = [c.c_char_p]
x.XOpenDisplay.restype = Display
x.XInternAtom.argtypes = [Display, c.c_char_p, c.c_int]
x.XInternAtom.restype = Atom
x.XGetWMProtocols.argtypes = [Display, Window, c.POINTER(c.POINTER(Atom)), c.POINTER(c.c_int)]
x.XFree.argtypes = [c.c_void_p]
x.XSync.argtypes = [Display, c.c_int]
x.XCloseDisplay.argtypes = [Display]
class Data(c.Union):
    _fields_ = [("b", c.c_char * 20), ("s", c.c_short * 10), ("l", c.c_long * 5)]
class ClientMessage(c.Structure):
    _fields_ = [("type", c.c_int), ("serial", c.c_ulong), ("send_event", c.c_int),
                ("display", Display), ("window", Window), ("message_type", Atom),
                ("format", c.c_int), ("data", Data)]
class Event(c.Union):
    _fields_ = [("client", ClientMessage), ("pad", c.c_long * 24)]
x.XSendEvent.argtypes = [Display, Window, c.c_int, c.c_long, c.POINTER(Event)]
display = x.XOpenDisplay(None)
assert display, "private X display unavailable"
window = int(sys.argv[1])
protocols = c.POINTER(Atom)()
count = c.c_int()
protocol_atom = x.XInternAtom(display, b"WM_PROTOCOLS", 0)
delete_atom = x.XInternAtom(display, b"WM_DELETE_WINDOW", 0)
queried = x.XGetWMProtocols(display, window, c.byref(protocols), c.byref(count))
available = [protocols[i] for i in range(count.value)] if queried else []
if queried:
    x.XFree(protocols)
supported = delete_atom in available
sent = 0
if supported:
    event = Event()
    event.client.type = 33  # ClientMessage
    event.client.send_event = 1
    event.client.display = display
    event.client.window = window
    event.client.message_type = protocol_atom
    event.client.format = 32
    event.client.data.l[0] = delete_atom
    event.client.data.l[1] = 0  # CurrentTime
    sent = x.XSendEvent(display, window, 0, 0, c.byref(event))
    x.XSync(display, 0)
print(json.dumps({"window": window, "WM_PROTOCOLS": available, "WM_DELETE_WINDOW": delete_atom,
                  "supported": supported, "sent": sent, "unix_ms": time.time_ns() // 1000000}))
x.XCloseDisplay(display)
sys.exit(0 if supported and sent else 3)
PYX
then
  printf '0\n' > /evidence/wm-delete-helper.status
  for ((attempt=0; attempt<100; attempt++)); do
    if ! kill -0 "$app_pid" 2>/dev/null; then break; fi
    sleep 0.1
  done
else
  printf '%s\n' "$?" > /evidence/wm-delete-helper.status
fi
shutdown=graceful-WM_DELETE_WINDOW
if kill -0 "$app_pid" 2>/dev/null; then
  shutdown=UNVERIFIED-graceful-SIGTERM-fallback
  printf 'WM_DELETE_WINDOW unsupported or no exit within10s; SIGTERM fixture cleanup\n' > /evidence/graceful-unverified.txt
  kill "$app_pid"
fi
if wait "$app_pid"; then status=0; else status=$?; fi
printf '%s\n' "$status" > /evidence/reload-graceful-stop.status
[[ "$status" = 0 || ( "$status" = 143 && "$shutdown" = UNVERIFIED-graceful-SIGTERM-fallback ) ]]
app_pid=""
find "$themes" -type f -exec sha256sum {} + | sort > /evidence/cold-before.sha256
"$NATIVE_CAPTURE_BINARY" >> /evidence/app.stdout.log 2>> /evidence/app.stderr.log &
app_pid=$!
sleep 6
kill -0 "$app_pid"
find "$themes" -type f -exec sha256sum {} + | sort > /evidence/cold-after.sha256
cmp /evidence/cold-before.sha256 /evidence/cold-after.sha256
jq -e '.active_theme_id == "catppuccin-latte"' "$settings"
assert_pixel EFF1F5
magick import -window root /evidence/cold-missing.png

# Separate invalid-file cold start: bytes exist before launch, never seed/repair them.
kill "$app_pid"
if wait "$app_pid"; then status=0; else status=$?; fi
printf '%s\n' "$status" > /evidence/cold-missing-stop.status
[[ "$status" = 0 || "$status" = 143 ]]
app_pid=""
printf '{cold invalid user bytes' > "$themes/catppuccin-latte.theme.json"
cp "$themes/catppuccin-latte.theme.json" /evidence/cold-invalid-original.json
cp "$settings" /evidence/cold-invalid-before.settings.json
find "$themes" -type f -exec sha256sum {} + | sort > /evidence/cold-invalid-before.sha256
"$NATIVE_CAPTURE_BINARY" >> /evidence/app.stdout.log 2>> /evidence/app.stderr.log &
app_pid=$!
sleep 6
kill -0 "$app_pid"
find "$themes" -type f -exec sha256sum {} + | sort > /evidence/cold-invalid-after.sha256
cmp /evidence/cold-invalid-before.sha256 /evidence/cold-invalid-after.sha256
cmp /evidence/cold-invalid-original.json "$themes/catppuccin-latte.theme.json"
cp "$settings" /evidence/cold-invalid-after.settings.json
cmp /evidence/cold-invalid-before.settings.json /evidence/cold-invalid-after.settings.json
jq -e '.active_theme_id == "catppuccin-latte"' "$settings"
test ! -e "$themes/catppuccin-mocha.theme.json"
assert_pixel EFF1F5
magick import -window root /evidence/cold-invalid.png
printf 'boundary=extracted-debug-deb-not-OS-installed\ntrigger=real-local-JSON-save\nstate=PTY-pid-starttime-cwd-exe-and-settings-identical\nui=screenshots-require-independent-review\nrecovery=no-live-reseed\n' > /evidence/reload-result.txt
printf 'shutdown=%s\ncold-invalid=bytes-settings-preserved-embedded-latte-no-reseed\n' "$shutdown" >> /evidence/reload-result.txt
trap - ERR
