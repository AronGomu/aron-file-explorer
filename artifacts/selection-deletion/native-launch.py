from pathlib import Path
import os, subprocess, json
root = Path.cwd()
fixture = root / '.tmp/deletion-native'
for name in ['home', 'config', 'data', 'cache', 'state', 'cwd', 'files']:
    (fixture / name).mkdir(parents=True, exist_ok=True)
for name in ['alpha.txt', 'bravo.txt', 'charlie.txt', 'delta.txt', 'echo.txt', 'foxtrot.txt']:
    (fixture / 'files' / name).write_text('native selection deletion undo fixture\n')
env = dict(os.environ)
env.update({'HOME': str(fixture / 'home'), 'XDG_CONFIG_HOME': str(fixture / 'config'), 'XDG_DATA_HOME': str(fixture / 'data'), 'XDG_CACHE_HOME': str(fixture / 'cache'), 'XDG_STATE_HOME': str(fixture / 'state'), 'WEBKIT_INSPECTOR_HTTP_SERVER': '127.0.0.1:9234', 'GDK_BACKEND': 'x11', 'WEBKIT_DISABLE_DMABUF_RENDERER': '1'})
with (fixture / 'native.log').open('w') as output:
    process = subprocess.Popen([str(root / 'target/debug/src-tauri'), str(fixture / 'files')], cwd=fixture / 'cwd', env=env, stdout=output, stderr=output, start_new_session=True)
(fixture / 'pid').write_text(str(process.pid))
print('Native fixture PID', process.pid)
