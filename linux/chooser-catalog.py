#!/usr/bin/env python3
"""Assemble a user portal catalog while retaining installed system implementations."""
import os
from pathlib import Path


def refresh(destination=None, config_path=None):
    data = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
    destination = destination or data / 'explr-chooser/portals'
    destination.mkdir(parents=True, exist_ok=True)
    # The catalog override also overrides the broker's configuration search.
    # Link the merged config so later user edits remain effective.
    if config_path is None:
        config = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'xdg-desktop-portal'
        desktops = [name.lower() for name in os.environ.get('XDG_CURRENT_DESKTOP', '').split(':') if name]
        config_path = next((config / name for name in [*(d + '-portals.conf' for d in desktops), 'portals.conf'] if (config / name).is_file()), None)
    if config_path is not None:
        target = destination / 'portals.conf'
        if target.is_symlink() and target.readlink() != config_path:
            target.unlink()
        if not target.is_symlink() and not target.exists():
            target.symlink_to(config_path)
    source = Path('/usr/share/xdg-desktop-portal/portals')
    for portal in source.glob('*.portal'):
        target = destination / portal.name
        if portal.name == 'explr.portal':
            continue
        if target.is_symlink() and not target.exists():
            target.unlink()
        if not target.exists():
            target.symlink_to(portal)
    # Only remove stale links created from the system catalog.
    for target in destination.glob('*.portal'):
        if target.is_symlink() and not target.exists() and target.readlink().parent == source:
            target.unlink()


if __name__ == '__main__':
    refresh()
