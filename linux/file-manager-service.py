#!/usr/bin/env python3
"""D-Bus activation bridge for desktop 'Open folder' and 'Show in folder'."""
from pathlib import Path
import os
import subprocess
from urllib.parse import unquote, urlsplit

INTERFACE = 'org.freedesktop.FileManager1'
OBJECT_PATH = '/org/freedesktop/FileManager1'
XML = '''<node><interface name="org.freedesktop.FileManager1">
<method name="ShowFolders"><arg type="as" direction="in"/><arg type="s" direction="in"/></method>
<method name="ShowItems"><arg type="as" direction="in"/><arg type="s" direction="in"/></method>
<method name="ShowItemProperties"><arg type="as" direction="in"/><arg type="s" direction="in"/></method>
</interface></node>'''


def launch_arguments(method, uris):
    flags = {'ShowFolders': [], 'ShowItems': ['--select'], 'ShowItemProperties': ['--properties']}
    if method not in flags:
        raise ValueError('Unsupported file-manager operation')
    paths = []
    for uri in uris:
        parsed = urlsplit(uri)
        if parsed.scheme != 'file' or parsed.netloc not in ('', 'localhost') or parsed.query or parsed.fragment:
            raise ValueError('Only local file URIs are supported')
        path = Path(unquote(parsed.path))
        if not path.is_absolute() or not path.exists() and not path.is_symlink():
            raise ValueError('The requested local item does not exist')
        if method == 'ShowFolders' and not path.is_dir():
            raise ValueError('ShowFolders requires directories')
        paths.append(str(path))
    return [*flags[method], *paths]


def main():
    import gi
    gi.require_version('Gio', '2.0')
    from gi.repository import Gio, GLib

    connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    loop = GLib.MainLoop()

    def handle_call(connection, sender, object_path, interface, method, parameters, invocation):
        uris, startup_id = parameters.unpack()
        try:
            arguments = launch_arguments(method, uris)
            if uris:
                env = dict(os.environ)
                if startup_id:
                    env['DESKTOP_STARTUP_ID'] = startup_id
                subprocess.Popen([str(Path.home() / '.local/bin/explr'), *arguments],
                                 cwd=Path.home(), env=env, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True)
            invocation.return_value(GLib.Variant('()', ()))
        except ValueError as error:
            invocation.return_dbus_error('org.freedesktop.DBus.Error.InvalidArgs', str(error))
        except OSError:
            invocation.return_dbus_error('org.freedesktop.DBus.Error.Failed', 'Could not launch Explr')

    node = Gio.DBusNodeInfo.new_for_xml(XML)
    connection.register_object(OBJECT_PATH, node.interfaces[0], handle_call, None, None)
    Gio.bus_own_name_on_connection(connection, INTERFACE, Gio.BusNameOwnerFlags.NONE,
                                   None, lambda *_: loop.quit())
    loop.run()


if __name__ == '__main__':
    main()
