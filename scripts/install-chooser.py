#!/usr/bin/env python3
"""Install Explr's separate chooser and merge its portal routing, with recoverable backups.

Does not restart running services. --root stages a complete installation for tests.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]
KEY = 'org.freedesktop.impl.portal.FileChooser'


def merge_routing(text):
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines) if line.strip() == '[preferred]'), None)
    if start is None:
        return text.rstrip() + '\n\n[preferred]\n' + KEY + '=explr;gtk\n'
    end = next((i for i in range(start + 1, len(lines)) if lines[i].strip().startswith('[')), len(lines))
    found = [i for i in range(start + 1, end) if lines[i].split('=', 1)[0].strip() == KEY]
    if len(found) > 1:
        raise ValueError('Duplicate FileChooser routing entries; resolve before installing')
    replacement = KEY + '=explr;gtk'
    if found:
        old = lines[found[0]].split('=', 1)[1].strip().split(';')
        backends = ['explr'] + [x for x in old if x and x not in ('explr', 'none', '*')]
        replacement = KEY + '=' + ';'.join(dict.fromkeys(backends))
        lines[found[0]] = replacement
    else:
        lines.insert(end, replacement)
    return '\n'.join(lines) + '\n'


def effective_config(config, data, desktops):
    directories = [config, *map(Path, os.environ.get('XDG_CONFIG_DIRS', '/etc/xdg').split(':')),
                   Path('/etc'), data, *map(Path, os.environ.get('XDG_DATA_DIRS', '/usr/local/share:/usr/share').split(':'))]
    names = [d + '-portals.conf' for d in desktops] + ['portals.conf']
    for directory in directories:
        for name in names:
            candidate = directory / 'xdg-desktop-portal' / name
            if candidate.is_file():
                return candidate.read_text()
    raise ValueError('No existing portal configuration found; configure desktop defaults first')


def atomic_write(path, data, mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def restore(manifest_path):
    manifest_path = Path(manifest_path).resolve()
    records = json.loads(manifest_path.read_text())
    # Validate the entire batch before restoring any file.
    for record in records:
        path = Path(record['path'])
        if path.is_symlink() or not path.is_file() or digest(path.read_bytes()) != record['installed']:
            raise ValueError('Installed file changed since backup: ' + str(path))
    for record in reversed(records):
        path = Path(record['path'])
        if record['backup'] is None:
            path.unlink()
        else:
            atomic_write(path, (manifest_path.parent / record['backup']).read_bytes(), record['mode'])
    print('Restored the previous installation and routing. Reload user services and restart xdg-desktop-portal when idle.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, help='Stage under this synthetic home directory')
    parser.add_argument('--binary', type=Path, default=ROOT / 'target/release/src-tauri')
    parser.add_argument('--restore', type=Path, help='Restore an unchanged installation from its backup manifest')
    args = parser.parse_args()
    if args.restore:
        restore(args.restore)
        return
    if not args.binary.is_file() or not os.access(args.binary, os.X_OK):
        parser.error('Build the native chooser first with npm run build:chooser')
    root = args.root.resolve() if args.root else Path.home()
    config = root / '.config' if args.root else Path(os.environ.get('XDG_CONFIG_HOME', root / '.config'))
    data = root / '.local/share' if args.root else Path(os.environ.get('XDG_DATA_HOME', root / '.local/share'))
    state = root / '.local/state' if args.root else Path(os.environ.get('XDG_STATE_HOME', root / '.local/state'))
    library = root / '.local/lib/explr-chooser'
    desktops = [d.lower() for d in os.environ.get('XDG_CURRENT_DESKTOP', '').split(':') if re.fullmatch(r'[A-Za-z0-9_-]+', d)]
    route = config / 'xdg-desktop-portal' / ((desktops[0] + '-portals.conf') if desktops else 'portals.conf')
    baseline = effective_config(config, data, desktops)
    # These generated paths enter .service and .desktop syntax, not a shell.
    def quoted(path):
        return '"' + str(path).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'
    files = {
        library / 'explr-chooser': (args.binary.read_bytes(), 0o755),
        library / 'chooser-portal.py': ((ROOT / 'linux/chooser-portal.py').read_bytes(), 0o755),
        library / 'chooser-catalog.py': ((ROOT / 'linux/chooser-catalog.py').read_bytes(), 0o755),
        data / 'explr-chooser/portals/explr.portal': ((ROOT / 'linux/explr.portal').read_bytes(), 0o644),
        data / 'dbus-1/services/org.freedesktop.impl.portal.desktop.explr.service': (
            ('[D-BUS Service]\nName=org.freedesktop.impl.portal.desktop.explr\nExec=/usr/bin/python3 ' + quoted(library / 'chooser-portal.py') + '\nSystemdService=xdg-desktop-portal-explr.service\n').encode(), 0o644),
        config / 'systemd/user/xdg-desktop-portal-explr.service': (
            ('[Unit]\nDescription=Explr file chooser portal\nPartOf=graphical-session.target\nAfter=graphical-session.target\n\n[Service]\nType=dbus\nBusName=org.freedesktop.impl.portal.desktop.explr\nExecStart=/usr/bin/python3 ' + quoted(library / 'chooser-portal.py') + '\nUMask=0077\n').encode(), 0o644),
        config / 'systemd/user/xdg-desktop-portal.service.d/50-explr-chooser.conf': (
            ('[Service]\nEnvironment="XDG_DESKTOP_PORTAL_DIR=' + str(data / 'explr-chooser/portals').replace('%', '%%').replace('"', '\\"') + '"\nExecStartPre=/usr/bin/python3 ' + quoted(library / 'chooser-catalog.py') + '\n').encode(), 0o644),
        route: (merge_routing(baseline).encode(), 0o644),
    }
    for path in files:
        if path.is_symlink():
            raise ValueError('Refusing to replace a managed symlink: ' + str(path))
        if path.exists() and not path.is_file():
            raise ValueError('Destination is not a regular file: ' + str(path))
    backup = state / 'explr-chooser/backups' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(parents=True, mode=0o700)
    records = []
    for index, (path, (contents, mode)) in enumerate(files.items()):
        old = path.read_bytes() if path.exists() else None
        if old == contents and (path.stat().st_mode & 0o777) == mode:
            continue
        name = str(index) if old is not None else None
        old_mode = path.stat().st_mode & 0o777 if old is not None else None
        if name is not None:
            atomic_write(backup / name, old, 0o600)
        records.append(dict(path=str(path), backup=name, mode=old_mode, installed=digest(contents)))
    manifest = backup / 'manifest.json'
    atomic_write(manifest, json.dumps(records, indent=2).encode(), 0o600)
    for record in records:
        contents, mode = files[Path(record['path'])]
        atomic_write(Path(record['path']), contents, mode)
    # The user catalog includes live links to every system portal (including screen sharing).
    import importlib.util
    spec = importlib.util.spec_from_file_location('catalog', ROOT / 'linux/chooser-catalog.py')
    catalog = importlib.util.module_from_spec(spec); spec.loader.exec_module(catalog)
    catalog.refresh(data / 'explr-chooser/portals', route)
    print(json.dumps({'binarySha256': digest(args.binary.read_bytes()), 'backupManifest': str(manifest), 'filesWritten': len(records), 'activation': 'systemctl --user daemon-reload && systemctl --user restart xdg-desktop-portal.service'}, indent=2))


if __name__ == '__main__':
    main()
