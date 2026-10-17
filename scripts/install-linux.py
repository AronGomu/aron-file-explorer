#!/usr/bin/env python3
"""Build and atomically reinstall Explr for the current Linux user."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import os
import shlex
import shutil
import signal
import time
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def run(*arguments, **kwargs):
    return subprocess.run(arguments, check=True, **kwargs)


def main():
    if sys.platform != 'linux':
        raise SystemExit('This installer supports Linux only.')
    for command in ('node', 'cargo', 'desktop-file-validate', 'update-desktop-database', 'xdg-mime', 'gio', 'lsblk', 'udisksctl', 'ffmpeg', 'mv'):
        if not shutil.which(command):
            raise SystemExit(f'Missing prerequisite: {command}')
    run('/usr/bin/python3', '-c', 'from gi.repository import Gio, GLib')
    cli = ROOT / 'node_modules/.bin/tauri'
    if not cli.exists():
        raise SystemExit('Install project dependencies with npm ci before running the installer.')
    run(str(cli), 'build', '--no-bundle', '--ci', '--', '--locked', cwd=ROOT)

    home = Path.home()
    data = Path(os.environ.get('XDG_DATA_HOME', home / '.local/share'))
    state = Path(os.environ.get('XDG_STATE_HOME', home / '.local/state')) / 'explr'
    payload = home / '.local/lib/explr'
    launcher = home / '.local/bin/explr'
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    backup = state / 'install-backups' / stamp
    backup.mkdir(parents=True, mode=0o700)
    previous_handler = subprocess.check_output(['xdg-mime', 'query', 'default', 'inode/directory'], text=True).strip()
    (backup / 'previous-directory-handler.txt').write_text(previous_handler + '\n')
    changed = []

    def install_bytes(destination, content, mode=0o644):
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() or destination.is_symlink():
            if destination.is_symlink():
                raise RuntimeError(f'Refusing to replace a managed symlink: {destination}')
            if destination.read_bytes() == content and destination.stat().st_mode & 0o777 == mode:
                return
            saved = backup / destination.relative_to(home)
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(destination, saved)
        temporary = destination.with_name(destination.name + '.installing')
        with temporary.open('xb') as output:
            output.write(content)
        temporary.chmod(mode)
        temporary.replace(destination)
        changed.append(str(destination))

    binary = ROOT / 'target/release/src-tauri'
    install_bytes(payload / 'explr', binary.read_bytes(), 0o755)
    install_bytes(payload / 'themes/LICENSE', (ROOT / 'src-tauri/resources/themes/LICENSE').read_bytes())
    install_bytes(payload / 'themes/sources.json', (ROOT / 'src-tauri/resources/themes/sources.json').read_bytes())
    for license_file in sorted((ROOT / 'src-tauri/resources/themes/licenses').iterdir()):
        install_bytes(payload / 'themes/licenses' / license_file.name, license_file.read_bytes())
    install_bytes(payload / 'file-manager-service.py', (ROOT / 'linux/file-manager-service.py').read_bytes())
    # Preserve the existing dotfiles-owned graphics launcher when present.
    if not launcher.exists():
        install_bytes(launcher, b'#!/bin/sh\nexec "$HOME/.local/lib/explr/explr" "$@"\n', 0o755)
    desktop = data / 'applications/com.explr.app.desktop'
    desktop_text = ('[Desktop Entry]\nType=Application\nName=Explr\nGenericName=File Manager\n'
                    'Comment=Browse files and folders\nExec=explr %U\nTryExec=explr\nIcon=com.explr.app\n'
                    'Terminal=false\nCategories=System;FileTools;FileManager;\nMimeType=inode/directory;\nStartupWMClass=Explr\n')
    install_bytes(desktop, desktop_text.encode())
    install_bytes(data / 'icons/hicolor/128x128/apps/com.explr.app.png', (ROOT / 'src-tauri/icons/logo_128x128.png').read_bytes())
    service = data / 'dbus-1/services/org.freedesktop.FileManager1.service'
    install_bytes(service, ('[D-BUS Service]\nName=org.freedesktop.FileManager1\nExec=/usr/bin/python3 ' +
                           shlex.quote(str(payload / 'file-manager-service.py')) + '\n').encode())
    config = Path(os.environ.get('XDG_CONFIG_HOME', home / '.config')) / 'mimeapps.list'
    if config.exists():
        shutil.copy2(config, backup / 'mimeapps.list')
    run('desktop-file-validate', str(desktop))
    run('update-desktop-database', str(desktop.parent))
    run('xdg-mime', 'default', 'com.explr.app.desktop', 'inode/directory')
    handler = subprocess.check_output(['xdg-mime', 'query', 'default', 'inode/directory'], text=True).strip()
    if handler != 'com.explr.app.desktop':
        raise RuntimeError('The desktop did not select Explr as the directory handler.')
    # Re-read activation files and restart only our stateless bridge, never another file manager.
    from gi.repository import Gio, GLib
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    def dbus_call(method, parameters=None):
        return bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
                             'org.freedesktop.DBus', method, parameters, None,
                             Gio.DBusCallFlags.NONE, 5000, None)
    dbus_call('ReloadConfig')
    try:
        owner = dbus_call('GetNameOwner', GLib.Variant('(s)', ('org.freedesktop.FileManager1',))).unpack()[0]
        pid = dbus_call('GetConnectionUnixProcessID', GLib.Variant('(s)', (owner,))).unpack()[0]
        arguments = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
        if os.fsencode(payload / 'file-manager-service.py') not in arguments:
            raise RuntimeError('Another file manager still owns FileManager1. Close it, then rerun installation.')
        os.kill(pid, signal.SIGTERM)
        for _ in range(100):
            if not dbus_call('NameHasOwner', GLib.Variant('(s)', ('org.freedesktop.FileManager1',))).unpack()[0]:
                break
            time.sleep(0.02)
    except GLib.Error as error:
        if 'NameHasNoOwner' not in str(error):
            raise
    bus.call_sync('org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
                  'org.freedesktop.FileManager1', 'ShowFolders', GLib.Variant('(ass)', ([], '')),
                  None, Gio.DBusCallFlags.NONE, 5000, None)
    bridge_pid = dbus_call('GetConnectionUnixProcessID', GLib.Variant('(s)', ('org.freedesktop.FileManager1',))).unpack()[0]
    if os.fsencode(payload / 'file-manager-service.py') not in Path(f'/proc/{bridge_pid}/cmdline').read_bytes().split(b'\0'):
        raise RuntimeError('FileManager1 activation did not select the installed Explr bridge.')
    manifest = {
        'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'sourceDirty': bool(subprocess.check_output(['git', 'status', '--porcelain', '--', 'src', 'src-tauri', 'package.json', 'package-lock.json', 'Cargo.toml', 'Cargo.lock'], cwd=ROOT)),
        'binarySha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
        'installedAt': stamp, 'binary': str(payload / 'explr'), 'backup': str(backup),
        'directoryHandler': handler, 'changed': changed,
    }
    state.mkdir(parents=True, exist_ok=True)
    (state / 'installation.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Installed Explr release; default directory handler: {handler}')
    print(f'Previous files retained in {backup}')
    print('Validate the installed native app before reporting this version as functional.')


if __name__ == '__main__':
    main()
