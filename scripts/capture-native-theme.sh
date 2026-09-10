#!/usr/bin/env bash
set -euo pipefail

inside() {
  test "${NATIVE_CAPTURE_SANDBOX:-}" = 1
  test "$HOME" = /fixture/home
  test "$PWD" = /fixture/cwd
  test ! -e /home
  test ! -e /run
  test ! -e /tmp/.X11-unix
  cat /proc/self/mountinfo > /evidence/mountinfo.txt
  printf 'cwd=%s\n' "$PWD" > /evidence/environment.txt
  for key in SHELL HOME TMPDIR XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_RUNTIME_DIR XDG_CONFIG_DIRS XDG_DATA_DIRS PATH FONTCONFIG_FILE GDK_BACKEND WEBKIT_DISABLE_COMPOSITING_MODE LIBGL_ALWAYS_SOFTWARE __EGL_VENDOR_LIBRARY_FILENAMES LIBGL_DRIVERS_PATH; do
    printf '%s=%s\n' "$key" "${!key}" >> /evidence/environment.txt
  done

  app_pid=""
  mkdir -m 1777 /tmp/.X11-unix
  Xvfb -displayfd 3 -screen 0 1200x800x24 -nolisten tcp \
    3>/evidence/display.number > /evidence/xvfb.stdout.log 2>/evidence/xvfb.stderr.log &
  display_pid=$!
  cleanup() {
    if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
      kill "$app_pid"
      set +e
      wait "$app_pid"
      status=$?
      set -e
      printf '%s\n' "$status" > /evidence/app-stop.status
    fi
    if kill -0 "$display_pid" 2>/dev/null; then
      kill "$display_pid"
      set +e
      wait "$display_pid"
      status=$?
      set -e
      printf '%s\n' "$status" > /evidence/xvfb-stop.status
    fi
  }
  trap cleanup EXIT
  for ((attempt=0; attempt<100; attempt++)); do
    kill -0 "$display_pid"
    [[ -s /evidence/display.number ]] && break
    sleep 0.1
  done
  test -s /evidence/display.number
  local display
  read -r display < /evidence/display.number
  [[ "$display" =~ ^[0-9]+$ ]]
  export DISPLAY=":$display"
  test -S "/tmp/.X11-unix/X$display"
  xwininfo -root -tree > /evidence/display-ready.txt
  printf 'pid=%s display=%s socket=/tmp/.X11-unix/X%s\n' "$display_pid" "$DISPLAY" "$display" > /evidence/display-owner.txt
  readlink "/proc/$display_pid/exe" >> /evidence/display-owner.txt
  printf '%s\n' 'Xvfb -displayfd 3 -screen 0 1200x800x24 -nolisten tcp' "$NATIVE_CAPTURE_BINARY" > /evidence/inside-argv.txt

  "$NATIVE_CAPTURE_BINARY" > /evidence/app.stdout.log 2> /evidence/app.stderr.log &
  app_pid=$!
  for ((attempt=0; attempt<150; attempt++)); do
    kill -0 "$app_pid"
    xwininfo -root -tree > /evidence/xwininfo.txt
    if grep -q '"Explr"' /evidence/xwininfo.txt; then break; fi
    sleep 0.2
  done
  grep -q '"Explr"' /evidence/xwininfo.txt
  sleep 8
  kill -0 "$app_pid"
  readlink "/proc/$app_pid/exe" > /evidence/running-executable.txt
  sha256sum "/proc/$app_pid/exe" > /evidence/running-executable.sha256
  kill -0 "$display_pid"
  xwininfo -root -tree > /evidence/xwininfo.txt
  magick import -window root /evidence/screenshot.png
  magick identify -format 'size=%wx%h colors=%k standard-deviation=%[standard-deviation]\n' /evidence/screenshot.png > /evidence/image-statistics.txt
  if (( $(magick identify -format '%k' /evidence/screenshot.png) <= 16 )); then
    printf 'Capture lacks rendered detail; inspect screenshot and app.stderr.log\n' >&2
    return 1
  fi
  printf 'alive-before-capture=yes\nstop=SIGTERM-after-capture\nvisual-review=required\n' > /evidence/app.status
  if [[ "${NATIVE_THEME_SELECTION:-0}" = 1 ]]; then
    source /selection.sh
  elif [[ "${NATIVE_THEME_SCENARIO:-}" = reload ]]; then
    source /reload.sh
  fi
  find /fixture -type f -printf '%P\n' | sort > /evidence/fixture-files.txt
  test ! -e /home
  test ! -e /run
  printf 'host-home=absent\nhost-system=absent\nprivate-X-socket=verified\n' > /evidence/namespace-postconditions.txt
  cleanup
  trap - EXIT
}

if [[ "${1:-}" = --inside ]]; then
  inside
  exit 0
fi
selection=0
scenario=""
if [[ "${1:-}" = --selection && $# = 1 ]]; then selection=1
elif [[ "${1:-}" = --scenario && $# = 2 ]]; then
  case "$2" in
    selection) selection=1 ;;
    reload) scenario=reload ;;
    *) printf 'Unknown native theme scenario: %s\n' "$2" >&2; exit 2 ;;
  esac
elif [[ $# != 0 ]]; then printf 'Usage: bash scripts/capture-native-theme.sh [--selection | --scenario selection|reload]\n' >&2; exit 2
fi

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
binary="$repo/target/debug/src-tauri"
app_binary=/app/src-tauri
binary_mount=(--ro-bind "$binary" "$app_binary")
if [[ -n "${THEME_VALIDATION_PACKAGE_ROOT:-}" ]]; then
  package_root=$(readlink -f "$THEME_VALIDATION_PACKAGE_ROOT")
  [[ "$package_root" = "$repo/.tmp/theme-validation/"* ]]
  binary="$package_root/usr/bin/src-tauri"
  app_binary=/usr/bin/src-tauri
  test -f "$package_root/usr/lib/Explr/themes/LICENSE"
  cmp "$repo/src-tauri/resources/themes/LICENSE" "$package_root/usr/lib/Explr/themes/LICENSE"
  binary_mount=(--ro-bind "$package_root/usr" /usr)
fi
test -x "$binary"
: "${THEME_VALIDATION_FONTS:?Set THEME_VALIDATION_FONTS to the nixpkgs dejavu_fonts store path}"
[[ "$THEME_VALIDATION_FONTS" = /nix/store/* ]]
test -d "$THEME_VALIDATION_FONTS/share/fonts"
: "${THEME_VALIDATION_MESA:?Set THEME_VALIDATION_MESA to the nixpkgs mesa store path}"
[[ "$THEME_VALIDATION_MESA" = /nix/store/* ]]
test -f "$THEME_VALIDATION_MESA/share/glvnd/egl_vendor.d/50_mesa.json"

sandbox_path=""
tools=(bash cat env sort find readlink mkdir sleep grep sha256sum Xvfb xwininfo magick)
if [[ "$selection" = 1 || "$scenario" = reload ]]; then tools+=(xdotool jq cp chmod cmp); fi
x11_library=""
if [[ "$scenario" = reload ]]; then
  tools+=(date mv rm python3)
  : "${THEME_VALIDATION_X11:?Set THEME_VALIDATION_X11 to the nixpkgs libX11 store path}"
  [[ "$THEME_VALIDATION_X11" = /nix/store/* ]]
  x11_library="$THEME_VALIDATION_X11/lib/libX11.so.6"
  test -f "$x11_library"
fi
for tool in "${tools[@]}"; do
  path=$(readlink -f "$(command -v "$tool")")
  [[ "$path" = /nix/store/* ]] || { printf 'Tool outside Nix store: %s\n' "$tool" >&2; exit 1; }
  sandbox_path="${sandbox_path:+$sandbox_path:}$(dirname "$path")"
done
shell=$(readlink -f "$(command -v bash)")
mkdir -p "$repo/.tmp/theme-validation" "$repo/artifacts/theme-validation/native"
scratch=$(mktemp -d "$repo/.tmp/theme-validation/native-capture.XXXXXX")
evidence="$repo/artifacts/theme-validation/native/$(basename "$scratch")"
mkdir "$evidence"
cleanup_scratch() {
  rm -r -- "$scratch"
  test ! -e "$scratch"
  printf 'removed=%s\n' "$scratch" > "$evidence/cleanup.txt"
}
trap cleanup_scratch EXIT
mkdir -p "$scratch/fixture/"{cwd,home,config,cache,data,state,runtime,config-dirs,data-dirs,tmp} "$scratch/etc/fonts"
chmod 700 "$scratch/fixture/runtime"
printf 'isolated native fixture\n' > "$scratch/fixture/home/README.txt"
printf 'fixture:x:%s:%s:Fixture:/fixture/home:%s\n' "$(id -u)" "$(id -g)" "$shell" > "$scratch/etc/passwd"
printf 'fixture:x:%s:\n' "$(id -g)" > "$scratch/etc/group"
printf '127.0.0.1 localhost\n' > "$scratch/etc/hosts"
printf '<fontconfig><dir>%s/share/fonts</dir><cachedir>/fixture/cache/fontconfig</cachedir></fontconfig>\n' "$THEME_VALIDATION_FONTS" > "$scratch/etc/fonts/fonts.conf"
source_state() {
  for dir in "$repo/config" "$repo/src-tauri/config"; do
    if [[ -d "$dir" ]]; then find "$dir" -type f -exec sha256sum {} + | sort; else printf 'absent %s\n' "$dir"; fi
  done
}
source_state > "$evidence/source-config.before"
sha256sum "$repo/Cargo.lock" "$binary" > "$evidence/build-identity.txt"
if [[ -n "${THEME_VALIDATION_PACKAGE_ROOT:-}" ]]; then
  printf 'kind=extracted-deb\npackage-root=%s\ninstalled=no\n' "$package_root" > "$evidence/package-fixture.txt"
  sha256sum "$package_root/usr/lib/Explr/themes/LICENSE" > "$evidence/package-license.sha256"
fi
args=(
  --die-with-parent --unshare-all --new-session --clearenv
  --ro-bind /nix/store /nix/store --proc /proc --dev /dev --tmpfs /tmp
  --dir /bin --symlink "$shell" /bin/sh
  --ro-bind "$scratch/etc" /etc
  --bind "$scratch/fixture" /fixture --bind "$evidence" /evidence
  "${binary_mount[@]}"
  --setenv NATIVE_CAPTURE_BINARY "$app_binary"
  --ro-bind "$repo/scripts/capture-native-theme.sh" /capture.sh
  --ro-bind "$repo/scripts/native-theme-selection.sh" /selection.sh
  --setenv NATIVE_THEME_SELECTION "$selection"
  --ro-bind "$repo/scripts/native-theme-reload.sh" /reload.sh
  --setenv NATIVE_THEME_SCENARIO "$scenario"
  --setenv NATIVE_X11_LIBRARY "$x11_library"
  --chdir /fixture/cwd
  --setenv PATH "$sandbox_path" --setenv NATIVE_CAPTURE_SANDBOX 1
  --setenv SHELL /bin/sh
  --setenv HOME /fixture/home --setenv TMPDIR /fixture/tmp
  --setenv XDG_CONFIG_HOME /fixture/config --setenv XDG_CACHE_HOME /fixture/cache
  --setenv XDG_DATA_HOME /fixture/data --setenv XDG_STATE_HOME /fixture/state
  --setenv XDG_RUNTIME_DIR /fixture/runtime
  --setenv XDG_CONFIG_DIRS /fixture/config-dirs --setenv XDG_DATA_DIRS /fixture/data-dirs
  --setenv FONTCONFIG_FILE /etc/fonts/fonts.conf --setenv LANG C.UTF-8
  --setenv GDK_BACKEND x11 --setenv WEBKIT_DISABLE_COMPOSITING_MODE 1
  --setenv LIBGL_ALWAYS_SOFTWARE 1
  --setenv __EGL_VENDOR_LIBRARY_FILENAMES "$THEME_VALIDATION_MESA/share/glvnd/egl_vendor.d/50_mesa.json"
  --setenv LIBGL_DRIVERS_PATH "$THEME_VALIDATION_MESA/lib/dri"
  "$shell" /capture.sh --inside
)
printf '%q ' "$(command -v bwrap)" "${args[@]}" > "$evidence/argv.sh"
printf '\n' >> "$evidence/argv.sh"
set +e
bwrap "${args[@]}" > "$evidence/sandbox.stdout.log" 2> "$evidence/sandbox.stderr.log"
status=$?
set -e
printf '%s\n' "$status" > "$evidence/sandbox.status"
source_state > "$evidence/source-config.after"
cmp "$evidence/source-config.before" "$evidence/source-config.after"
printf 'source-config=unchanged\nscratch-cleanup=on-exit\n' > "$evidence/postconditions.txt"
printf 'Native capture: %s (exit %s)\n' "$evidence" "$status"
exit "$status"
