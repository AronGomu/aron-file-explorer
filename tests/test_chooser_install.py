import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('installer', ROOT / 'scripts/install-chooser.py')
installer = importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)


class InstallationTests(unittest.TestCase):
    def test_merge_preserves_other_portals_comments_and_existing_fallback(self):
        before = '# custom\n[preferred]\ndefault=hyprland;gtk\norg.freedesktop.impl.portal.ScreenCast=hyprland\norg.freedesktop.impl.portal.FileChooser=kde;gtk\n[other]\nthing=value\n'
        after = installer.merge_routing(before)
        self.assertIn('FileChooser=explr;kde;gtk', after)
        self.assertIn('ScreenCast=hyprland', after)
        self.assertTrue(after.startswith('# custom\n'))
        self.assertIn('[other]\nthing=value', after)
        self.assertEqual(installer.merge_routing(after), after)

    def test_staged_install_and_restore_preserve_existing_configuration(self):
        (ROOT / '.tmp').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / '.tmp', prefix='chooser-install-') as temporary:
            root = Path(temporary)
            config = root / '.config/xdg-desktop-portal/hyprland-portals.conf'
            config.parent.mkdir(parents=True)
            before = '# retained\n[preferred]\ndefault=hyprland;gtk\n'
            config.write_text(before)
            binary = root / 'fixture-binary'; binary.write_text('#!/bin/sh\nexit 0\n'); binary.chmod(0o755)
            env = dict(os.environ, XDG_CURRENT_DESKTOP='Hyprland', PYTHONDONTWRITEBYTECODE='1')
            result = subprocess.check_output([sys.executable, str(ROOT / 'scripts/install-chooser.py'), '--root', str(root), '--binary', str(binary)], env=env, text=True)
            manifest = json.loads(result)['backupManifest']
            self.assertIn('FileChooser=explr;gtk', config.read_text())
            self.assertTrue((root / '.local/share/explr-chooser/portals/gtk.portal').is_symlink())
            subprocess.run([sys.executable, str(ROOT / 'scripts/install-chooser.py'), '--restore', manifest], env=env, check=True, capture_output=True)
            self.assertEqual(config.read_text(), before)
            self.assertFalse((root / '.local/lib/explr-chooser/explr-chooser').exists())

    def test_restore_refuses_to_destroy_later_user_edits(self):
        with tempfile.TemporaryDirectory(dir=ROOT / '.tmp', prefix='chooser-restore-') as temporary:
            root = Path(temporary); target = root / 'user.conf'; target.write_text('user edits')
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps([dict(path=str(target), backup=None, mode=None, installed=installer.digest(b'old installed'))]))
            with self.assertRaises(ValueError): installer.restore(manifest)
            self.assertEqual(target.read_text(), 'user edits')


if __name__ == '__main__': unittest.main()
