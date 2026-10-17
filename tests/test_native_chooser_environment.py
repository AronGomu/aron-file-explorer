import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_chooser', ROOT / 'scripts/test-native-chooser.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class NativeEnvironmentTests(unittest.TestCase):
    def test_private_x11_session_does_not_inherit_host_wayland_connection(self):
        inherited = dict(WAYLAND_DISPLAY='wayland-1', WAYLAND_SOCKET='9',
                         HYPRLAND_INSTANCE_SIGNATURE='host-session', DISPLAY=':0',
                         XDG_CURRENT_DESKTOP='Hyprland', XDG_SESSION_TYPE='wayland',
                         XDG_SESSION_DESKTOP='Hyprland', XDG_RUNTIME_DIR='/run/user/1000')
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, inherited):
            env = native.native_environment(Path(temporary))
            for key in ('WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'HYPRLAND_INSTANCE_SIGNATURE', 'DISPLAY'):
                self.assertNotIn(key, env)
            self.assertEqual(env['XDG_SESSION_TYPE'], 'x11')
            self.assertEqual(env['XDG_CURRENT_DESKTOP'], 'GTK')
            self.assertEqual(env['XDG_SESSION_DESKTOP'], 'gtk')
            self.assertEqual(env['GDK_BACKEND'], 'x11')
            runtime = Path(env['XDG_RUNTIME_DIR'])
            self.assertEqual(runtime.parent, Path(temporary))
            self.assertEqual(runtime.stat().st_mode & 0o777, 0o700)
            self.assertEqual(os.environ['WAYLAND_DISPLAY'], 'wayland-1')
            self.assertEqual(os.environ['DISPLAY'], ':0')

    def test_private_portal_routing_selects_only_gtk(self):
        with tempfile.TemporaryDirectory() as temporary:
            env = native.native_environment(Path(temporary))
            config = Path(env['XDG_CONFIG_HOME']) / 'xdg-desktop-portal/portals.conf'
            self.assertEqual(config.read_text(), '[preferred]\ndefault=gtk\n')


if __name__ == '__main__':
    unittest.main()
