#!/usr/bin/env python3
"""Exercise the real native chooser in a private Xvfb display, never the user's cursor."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / '.tmp/chooser-tools/usr/bin'
XVFB = os.environ.get('XVFB', shutil.which('Xvfb') or str(TOOLS / 'Xvfb'))
XDOTOOL = os.environ.get('XDOTOOL', shutil.which('xdotool') or str(TOOLS / 'xdotool'))
BINARY = Path(os.environ.get('CHOOSER_BINARY', ROOT / 'target/release/src-tauri'))


def wait_for(predicate, message, timeout=20):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = predicate()
        if value:
            return value
        time.sleep(.1)
    raise AssertionError(message)


def native_environment(directory):
    env = dict(os.environ, LD_LIBRARY_PATH=str(TOOLS.parent / 'lib'), GDK_BACKEND='x11',
               WEBKIT_DISABLE_DMABUF_RENDERER='1', WEBKIT_DISABLE_COMPOSITING_MODE='1', LIBGL_ALWAYS_SOFTWARE='1', GDK_SCALE='1',
               __EGL_VENDOR_LIBRARY_FILENAMES='/usr/share/glvnd/egl_vendor.d/50_mesa.json',
               __GLX_VENDOR_LIBRARY_NAME='mesa', GALLIUM_DRIVER='llvmpipe',
               XDG_CONFIG_HOME=str(directory / 'config'), XDG_DATA_HOME=str(directory / 'data'),
               XDG_CACHE_HOME=str(directory / 'cache'))
    # This GPU-free X11 test must not connect to the host Wayland compositor.
    for key in ('WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'HYPRLAND_INSTANCE_SIGNATURE', 'DISPLAY'):
        env.pop(key, None)
    env.update(XDG_CURRENT_DESKTOP='GTK', XDG_SESSION_TYPE='x11', XDG_SESSION_DESKTOP='gtk')
    runtime = directory / 'runtime'
    runtime.mkdir(mode=0o700)
    env['XDG_RUNTIME_DIR'] = str(runtime)
    portals = Path(env['XDG_CONFIG_HOME']) / 'xdg-desktop-portal'
    portals.mkdir(parents=True)
    (portals / 'portals.conf').write_text('[preferred]\ndefault=gtk\n')
    return env


def main():
    if os.environ.get('EXPLR_NATIVE_ISOLATED') != '1':
        os.execvp('bwrap', ['bwrap', '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-net', '--unshare-uts', '--die-with-parent', '--bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '--setenv', 'EXPLR_NATIVE_ISOLATED', '1', '--', sys.executable, __file__])
    (ROOT / '.tmp').mkdir(exist_ok=True)
    evidence = ROOT / 'artifacts/chooser'
    evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='chooser-native-', dir=ROOT / '.tmp') as temporary:
        directory = Path(temporary)
        env = native_environment(directory)
        Path('/tmp/.X11-unix').mkdir(exist_ok=True)
        # Avoid NVIDIA EGL/GBM device probing in the GPU-free test namespace.
        xvfb = subprocess.Popen([XVFB, '-displayfd', '1', '-screen', '0', '1200x800x24', '-nolisten', 'tcp', '-extension', 'GLX'], stdout=subprocess.PIPE, text=True, env=env)
        env['DISPLAY'] = ':' + xvfb.stdout.readline().strip()
        assert env['DISPLAY'].startswith(':') and len(env['DISPLAY']) > 1, 'Private Xvfb failed to start'
        # Activated services inherit this bus's environment, including private DISPLAY.
        bus = subprocess.Popen(['dbus-daemon', '--session', '--nofork', '--print-address=1'], stdout=subprocess.PIPE, text=True, env=env)
        env['DBUS_SESSION_BUS_ADDRESS'] = bus.stdout.readline().strip()
        fixture = directory / 'files'; fixture.mkdir()
        (fixture / 'folder').mkdir()
        (fixture / 'alpha.txt').write_text('Native chooser fixture.\n')
        (fixture / 'bravo.txt').write_text('Second fixture.\n')
        (fixture / 'image.png').write_bytes(b'not an image')
        children = []
        def xdo(*args):
            return subprocess.check_output([XDOTOOL, *map(str, args)], env=env, text=True).strip()
        def launch(name, **options):
            request_dir = directory / name; request_dir.mkdir()
            request = dict(mode='OpenFile', title='Chooser test ' + name, appId='native.test', parentWindow='', modal=True,
                           multiple=False, directory=False, currentFolder=str(fixture), currentName='', acceptLabel='', filters=[], currentFilter=None, choices=[], files=[])
            request.update(options)
            input_file = request_dir / 'request.json'; input_file.write_text(json.dumps(request))
            log = (request_dir / 'stderr.log').open('w')
            process = subprocess.Popen([str(BINARY), '--chooser-request', str(input_file)], env=env, stdout=log, stderr=log)
            children.append(process)
            def window():
                result = subprocess.run([XDOTOOL, 'search', '--onlyvisible', '--name', '^Chooser test ' + name + '$'], env=env, capture_output=True, text=True)
                if process.poll() is not None:
                    raise AssertionError((request_dir / 'stderr.log').read_text()[-3000:])
                return result.stdout.strip().splitlines()[0] if result.returncode == 0 else None
            wid = wait_for(window, 'Native window did not open')
            xdo('windowfocus', '--sync', wid)
            time.sleep(5)
            return process, request_dir, wid
        def result(process, request_dir):
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                raise AssertionError('Native response timeout: ' + (request_dir / 'stderr.log').read_text()[-3000:])
            path = request_dir / 'response.json'
            assert path.exists(), (request_dir / 'stderr.log').read_text()[-3000:]
            return json.loads(path.read_text())
        passed = []
        try:
            process, request_dir, wid = launch('cancel')
            subprocess.run(['magick', 'import', '-window', wid, str(evidence / 'native-chooser.png')], env=env, check=True)
            colors = int(subprocess.check_output(['magick', 'identify', '-format', '%k', str(evidence / 'native-chooser.png')], text=True))
            shutil.copyfile(request_dir / 'stderr.log', evidence / 'native.log')
            assert colors > 16, 'Native content did not render: ' + (request_dir / 'stderr.log').read_text()[-3000:]
            xdo('key', 'Escape')
            assert result(process, request_dir)['response'] == 1
            passed.append('Escape cancels the native window')
            process, request_dir, wid = launch('save', mode='SaveFile', currentName='saved.txt')
            xdo('key', 'Return')
            saved = result(process, request_dir)
            assert saved['uris'] == [(fixture / 'saved.txt').as_uri()]
            assert not (fixture / 'saved.txt').exists()
            passed.append('Save returns a destination without creating a file')
            process, request_dir, wid = launch('open')
            xdo('key', 'Down', 'Return')
            assert result(process, request_dir)['uris'] == [(fixture / 'alpha.txt').as_uri()]
            passed.append('Keyboard selection returns the selected file')
            process, request_dir, wid = launch('multi', multiple=True)
            xdo('key', 'Down', 'shift+Down', 'Return')
            assert result(process, request_dir)['uris'] == [(fixture / 'alpha.txt').as_uri(), (fixture / 'bravo.txt').as_uri()]
            passed.append('Multiple selection returns both files')
            process, request_dir, wid = launch('folder', directory=True)
            xdo('mousemove', '--window', wid, 960, 668, 'click', 1)
            assert result(process, request_dir)['uris'] == [(fixture / 'folder').as_uri()]
            passed.append('Folder mode returns a directory')
            process, request_dir, wid = launch('batch', mode='SaveFiles', files=['alpha.txt', 'alpha.txt'])
            xdo('mousemove', '--window', wid, 960, 668, 'click', 1)
            batch = result(process, request_dir)
            assert [unquote(urlsplit(uri).path) for uri in batch['uris']] == [str(fixture / 'folder/alpha.txt'), str(fixture / 'folder/alpha (1).txt')], batch
            passed.append('Batch save preserves order and allocates distinct names')
            (evidence / 'native-report.json').write_text(json.dumps({'passed': passed, 'binary': str(BINARY)}, indent=2))
            print(json.dumps({'passed': passed, 'screenshot': str(evidence / 'native-chooser.png')}, indent=2))
        finally:
            for child in children:
                if child.poll() is None:
                    child.terminate()
                    try: child.wait(timeout=5)
                    except subprocess.TimeoutExpired: child.kill(); child.wait()
            xvfb.terminate(); xvfb.wait(timeout=5)
            bus.terminate(); bus.wait(timeout=5)


if __name__ == '__main__':
    main()
