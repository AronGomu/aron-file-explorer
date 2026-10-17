#!/usr/bin/env python3
"""Exercise the real backend on a private bus with a deterministic native-process fixture."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from gi.repository import Gio, GLib

ROOT = Path(__file__).resolve().parents[1]
NAME = 'org.freedesktop.impl.portal.desktop.explr'
PATH = '/org/freedesktop/portal/desktop'
IFACE = 'org.freedesktop.impl.portal.FileChooser'


def main():
    if '--private-bus' not in sys.argv:
        os.execvp('dbus-run-session', ['dbus-run-session', '--', sys.executable, __file__, '--private-bus'])
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName', GLib.Variant('(su)', ('org.freedesktop.portal.Desktop', 0)), None, Gio.DBusCallFlags.NONE, 3000, None)
    (ROOT / '.tmp').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='chooser-dbus-', dir=ROOT / '.tmp') as temporary:
        directory = Path(temporary)
        binary = directory / 'fixture'
        binary.write_text('''#!/usr/bin/python3
import json,sys,time
from pathlib import Path
p=Path(sys.argv[2]); r=json.loads(p.read_text())
if r['title']=='hold': time.sleep(60)
elif r['title']=='crash': sys.exit(2)
else:
 time.sleep(.2)
 (p.parent/'response.json').write_text(json.dumps({'response':0,'uris':['file:///tmp/'+r['title']],'choices':[['flag','true']],'current_filter':['Text',[[0,'*.txt']]]}))
''')
        binary.chmod(0o700)
        backend = subprocess.Popen([sys.executable, str(ROOT / 'linux/chooser-portal.py'), '--binary', str(binary)], env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1', XDG_RUNTIME_DIR=temporary))
        results = {}
        def iterate_until(predicate, timeout=10):
            end = time.monotonic() + timeout
            context = GLib.MainContext.default()
            while not predicate() and time.monotonic() < end:
                while context.pending(): context.iteration(False)
                time.sleep(.02)
            assert predicate(), 'Timed out waiting for D-Bus result'
        def owner():
            return bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner', GLib.Variant('(s)', (NAME,)), None, Gio.DBusCallFlags.NONE, 3000, None).unpack()[0]
        def callback(connection, result, key):
            try: results[key] = connection.call_finish(result).unpack()
            except GLib.Error as error: results[key] = error
        def call(key, title, method='OpenFile', options=None):
            handle = PATH + '/request/test/' + key
            bus.call(NAME, PATH, IFACE, method, GLib.Variant('(osssa{sv})', (handle, 'test.app', '', title, options or {})), GLib.VariantType.new('(ua{sv})'), Gio.DBusCallFlags.NONE, 10000, None, callback, key)
            return handle
        try:
            iterate_until(owner)
            call('first', 'first'); call('second', 'second')
            iterate_until(lambda: len(results) == 2)
            assert results['first'][1]['uris'] == ['file:///tmp/first']
            assert results['second'][1]['uris'] == ['file:///tmp/second']
            assert results['first'][1]['current_filter'] == ('Text', [(0, '*.txt')])
            handle = call('cancel', 'hold')
            def ready():
                return len(list(directory.glob('explr-chooser-*/request.json'))) == 1
            iterate_until(ready)
            bus.call_sync(NAME, handle, 'org.freedesktop.impl.portal.Request', 'Close', None, None, Gio.DBusCallFlags.NONE, 3000, None)
            iterate_until(lambda: 'cancel' in results)
            assert results['cancel'] == (1, {})
            # Reuse a completed handle while the killed process's wait callback may still run.
            results.pop('cancel'); call('cancel', 'reused')
            iterate_until(lambda: 'cancel' in results)
            assert results['cancel'][1]['uris'] == ['file:///tmp/reused']
            call('crash', 'crash'); call('invalid', 'invalid', 'SaveFiles')
            iterate_until(lambda: 'crash' in results and 'invalid' in results)
            assert results['crash'] == (2, {})
            assert isinstance(results['invalid'], GLib.Error)
            # A second, unauthorised connection cannot masquerade as the portal broker.
            other = Gio.DBusConnection.new_for_address_sync(os.environ['DBUS_SESSION_BUS_ADDRESS'], Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)
            try:
                other.call_sync(NAME, PATH, IFACE, 'OpenFile', GLib.Variant('(osssa{sv})', (PATH + '/request/other/one', '', '', '', {})), None, Gio.DBusCallFlags.NONE, 3000, None)
                raise AssertionError('Unauthorized caller accepted')
            except GLib.Error as error:
                assert 'AccessDenied' in str(error)
            other.close_sync(None)
            iterate_until(lambda: not list(directory.glob('explr-chooser-*')))
            print('PASS: concurrent requests, choices/filters, cancellation, handle reuse, crash, invalid input, caller identity, temporary-file cleanup')
        finally:
            backend.terminate()
            backend.wait(timeout=5)


if __name__ == '__main__':
    main()
