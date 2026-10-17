#!/usr/bin/env python3
"""XDG FileChooser backend. One native Explr process and private directory per request."""
import argparse
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
from urllib.parse import urlsplit

import gi
gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

BUS_NAME = "org.freedesktop.impl.portal.desktop.explr"
INTERFACE = "org.freedesktop.impl.portal.FileChooser"
REQUEST_INTERFACE = "org.freedesktop.impl.portal.Request"
PORTAL_PATH = "/org/freedesktop/portal/desktop"
METHOD_ARGS = '<arg type="o" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="u" direction="out"/><arg type="a{sv}" direction="out"/>'
XML = '<node><interface name="' + INTERFACE + '">' + ''.join(
    '<method name="' + method + '">' + METHOD_ARGS + '</method>'
    for method in ("OpenFile", "SaveFile", "SaveFiles")
) + '</interface></node>'
REQUEST_XML = '<node><interface name="' + REQUEST_INTERFACE + '"><method name="Close"/></interface></node>'


def filename_bytes(value):
    raw = bytes(value)
    if not raw or raw[-1] != 0 or b"\0" in raw[:-1]:
        raise ValueError("File paths must be NUL-terminated byte arrays")
    # The existing Explr frontend uses UTF-8 paths. Reject rather than corrupt others.
    return raw[:-1].decode("utf-8", errors="strict")


def normalize(method, app_id, parent, title, options):
    folder = filename_bytes(options["current_folder"]) if "current_folder" in options else str(Path.home())
    name = options.get("current_name", "")
    if method == "SaveFile" and "current_file" in options:
        current = Path(filename_bytes(options["current_file"]))
        folder, name = str(current.parent), current.name
    request = dict(mode=method, appId=app_id, parentWindow=parent, title=title,
                   modal=options.get("modal", True), multiple=options.get("multiple", False) if method == "OpenFile" else False,
                   directory=options.get("directory", False) if method == "OpenFile" else False,
                   currentFolder=folder, currentName=name, acceptLabel=options.get("accept_label", ""),
                   filters=options.get("filters", []), currentFilter=options.get("current_filter"),
                   choices=options.get("choices", []), files=[filename_bytes(f) for f in options.get("files", [])])
    for field in ("modal", "multiple", "directory"):
        if type(request[field]) is not bool:
            raise ValueError("Invalid boolean option: " + field)
    for field in ("currentName", "acceptLabel"):
        if not isinstance(request[field], str) or "\0" in request[field]:
            raise ValueError("Invalid text option: " + field)
    if method == "SaveFiles" and not request["files"]:
        raise ValueError("SaveFiles requires at least one filename")
    for value in request["files"]:
        if not value or value in (".", "..") or "/" in value:
            raise ValueError("Invalid filename in SaveFiles")
    for file_filter in request["filters"] + ([request["currentFilter"]] if request["currentFilter"] else []):
        if len(file_filter) != 2 or not isinstance(file_filter[0], str):
            raise ValueError("Invalid file filter")
        for kind, pattern in file_filter[1]:
            if kind not in (0, 1) or not isinstance(pattern, str):
                raise ValueError("Invalid filter rule")
    ids = set()
    for identifier, label, values, selected in request["choices"]:
        if not identifier or identifier in ids or not label:
            raise ValueError("Invalid or duplicate choice")
        ids.add(identifier)
        keys = [key for key, _ in values] if values else ["true", "false"]
        if len(keys) != len(set(keys)) or any(not key for key in keys) or (selected and selected not in keys):
            raise ValueError("Invalid choice options")
    if len(json.dumps(request).encode()) > 1_048_576:
        raise ValueError("Chooser request too large")
    return request


def response_variant(result):
    response = result.get("response", 2)
    if response not in (0, 1, 2):
        raise ValueError("Invalid chooser response")
    values = {}
    if response == 0:
        uris = result["uris"]
        if not uris or any(urlsplit(uri).scheme != "file" or urlsplit(uri).netloc or not urlsplit(uri).path.startswith('/') for uri in uris):
            raise ValueError("Chooser returned a non-local URI")
        values["uris"] = GLib.Variant("as", uris)
        values["choices"] = GLib.Variant("a(ss)", result.get("choices", []))
        if result.get("current_filter") is not None:
            values["current_filter"] = GLib.Variant("(sa(us))", result["current_filter"])
    return GLib.Variant("(ua{sv})", (response, values))


class Portal:
    def __init__(self, connection, binary):
        self.connection = connection
        self.binary = str(Path(binary).resolve())
        self.pending = {}
        self.interface = Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0]
        self.request_interface = Gio.DBusNodeInfo.new_for_xml(REQUEST_XML).interfaces[0]
        self.registration = connection.register_object(PORTAL_PATH, self.interface, self.open, None, None)
        self.subscription = connection.signal_subscribe("org.freedesktop.DBus", "org.freedesktop.DBus", "NameOwnerChanged", "/org/freedesktop/DBus", None, Gio.DBusSignalFlags.NONE, self.owner_changed)

    def authorized(self, sender):
        try:
            owner = self.connection.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetNameOwner", GLib.Variant("(s)", ("org.freedesktop.portal.Desktop",)), GLib.VariantType.new("(s)"), Gio.DBusCallFlags.NONE, 3000, None).unpack()[0]
            return owner == sender
        except GLib.Error:
            return False

    def open(self, connection, sender, path, interface, method, parameters, invocation):
        if not self.authorized(sender):
            invocation.return_dbus_error("org.freedesktop.DBus.Error.AccessDenied", "Only xdg-desktop-portal may create chooser requests")
            return
        handle, app_id, parent, title, options = parameters.unpack()
        if handle in self.pending or not handle.startswith("/org/freedesktop/portal/desktop/request/"):
            invocation.return_dbus_error("org.freedesktop.DBus.Error.InvalidArgs", "Invalid or duplicate request handle")
            return
        if len(self.pending) >= 32:
            invocation.return_dbus_error("org.freedesktop.DBus.Error.LimitsExceeded", "Too many outstanding chooser requests")
            return
        try:
            request = normalize(method, app_id, parent, title, options)
        except (ValueError, TypeError, KeyError, UnicodeError) as error:
            invocation.return_dbus_error("org.freedesktop.DBus.Error.InvalidArgs", str(error))
            return
        temporary = tempfile.TemporaryDirectory(prefix="explr-chooser-", dir=os.environ.get("XDG_RUNTIME_DIR"))
        directory = Path(temporary.name)
        input_file = directory / "request.json"
        input_file.write_text(json.dumps(request), encoding="utf-8")
        os.chmod(input_file, 0o600)
        registration = connection.register_object(handle, self.request_interface, self.close_request, None, None)
        state = dict(invocation=invocation, sender=sender, temporary=temporary, directory=directory, registration=registration, process=None)
        self.pending[handle] = state
        try:
            launcher = Gio.SubprocessLauncher.new(Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE)
            # Match the parent's window system so GTK can establish a transient relationship.
            if parent.startswith("wayland:"):
                launcher.setenv("GDK_BACKEND", "wayland", True)
            elif parent.startswith("x11:"):
                launcher.setenv("GDK_BACKEND", "x11", True)
            launcher.setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1", False)
            launcher.setenv("WEBKIT_DISABLE_COMPOSITING_MODE", "1", False)
            launcher.setenv("LIBGL_ALWAYS_SOFTWARE", "1", False)
            process = launcher.spawnv([self.binary, "--chooser-request", str(input_file)])
            state["process"] = process
            process.wait_async(None, self.exited, handle)
        except GLib.Error:
            self.finish(handle, {"response": 2})

    def exited(self, process, result, handle):
        state = self.pending.get(handle)
        if state is None or state["process"] != process:
            return
        try:
            process.wait_finish(result)
            output = state["directory"] / "response.json"
            if output.exists() and output.stat().st_size <= 1_048_576:
                response = json.loads(output.read_text(encoding="utf-8"))
            else:
                response = {"response": 1 if process.get_if_exited() and process.get_exit_status() == 0 else 2}
            self.finish(handle, response)
        except (GLib.Error, ValueError, OSError, KeyError, TypeError):
            self.finish(handle, {"response": 2})

    def finish(self, handle, response):
        state = self.pending.pop(handle, None)
        if state is None:
            return
        try:
            value = response_variant(response)
        except (ValueError, TypeError, KeyError):
            value = response_variant({"response": 2})
        self.connection.unregister_object(state["registration"])
        state["invocation"].return_value(value)
        state["temporary"].cleanup()

    def close_request(self, connection, sender, path, interface, method, parameters, invocation):
        state = self.pending.get(path)
        if state and sender != state["sender"]:
            invocation.return_dbus_error("org.freedesktop.DBus.Error.AccessDenied", "Request belongs to another caller")
            return
        invocation.return_value(GLib.Variant("()", ()))
        self.cancel(path)

    def cancel(self, handle):
        state = self.pending.get(handle)
        if state:
            if state["process"]:
                state["process"].force_exit()
            self.finish(handle, {"response": 1})

    def owner_changed(self, connection, sender, path, interface, signal_name, parameters):
        name, old, new = parameters.unpack()
        if old and not new:
            for handle, state in list(self.pending.items()):
                if state["sender"] == name or (name == "org.freedesktop.portal.Desktop" and state["sender"] == old):
                    self.cancel(handle)

    def shutdown(self):
        for handle in list(self.pending):
            self.cancel(handle)
        self.connection.signal_unsubscribe(self.subscription)
        self.connection.unregister_object(self.registration)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", default=str(Path(__file__).with_name("explr-chooser")))
    args = parser.parse_args()
    if not os.access(args.binary, os.X_OK):
        parser.error("Native chooser binary is missing or not executable")
    loop = GLib.MainLoop()
    portals = []
    failed = []
    def acquired(connection, name):
        portals.append(Portal(connection, args.binary))
    def lost(connection, name):
        failed.append(True)
        loop.quit()
    owner = Gio.bus_own_name(Gio.BusType.SESSION, BUS_NAME, Gio.BusNameOwnerFlags.NONE, acquired, None, lost)
    def stop():
        loop.quit()
        return GLib.SOURCE_REMOVE
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, stop)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, stop)
    try:
        loop.run()
    finally:
        for portal in portals:
            portal.shutdown()
        Gio.bus_unown_name(owner)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
