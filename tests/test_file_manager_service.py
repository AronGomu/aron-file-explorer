"""FileManager1 routing tests; use disposable files and an isolated session bus."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / 'linux/file-manager-service.py'
spec = importlib.util.spec_from_file_location('file_manager_service', SERVICE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class FileManagerServiceTests(unittest.TestCase):
    def test_folders_reveal_and_properties_decode_local_file_uris(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            file = folder / 'file # with spaces.txt'
            file.write_text('fixture')
            self.assertEqual(bridge.launch_arguments('ShowFolders', [folder.as_uri()]), [str(folder)])
            self.assertEqual(bridge.launch_arguments('ShowItems', [file.as_uri()]), ['--select', str(file)])
            self.assertEqual(bridge.launch_arguments('ShowItemProperties', [file.as_uri()]), ['--properties', str(file)])

    def test_invalid_requests_cannot_launch_remote_uris_or_missing_items(self):
        for uri in ['https://example.com/', 'file://remote/tmp', 'file:///missing-explr-fixture']:
            with self.assertRaises(ValueError):
                bridge.launch_arguments('ShowItems', [uri])
        with self.assertRaises(ValueError):
            bridge.launch_arguments('Unknown', [])

    def test_real_dbus_methods_forward_arguments_without_launching_the_native_app(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            launcher = home / '.local/bin/explr'
            launcher.parent.mkdir(parents=True)
            launcher.write_text('#!/usr/bin/python3\nimport json,sys,os\nfrom pathlib import Path\n'
                                'with (Path.home()/"calls.jsonl").open("a") as output: output.write(json.dumps(sys.argv[1:])+"\\n")\n')
            launcher.chmod(0o755)
            file = home / 'file with spaces.txt'
            file.write_text('fixture')
            harness = r'''
import subprocess,sys,time
from pathlib import Path
server=subprocess.Popen(['/usr/bin/python3',sys.argv[1]])
base=['gdbus','call','--session','--dest','org.freedesktop.FileManager1','--object-path','/org/freedesktop/FileManager1']
try:
    for _ in range(100):
        ready=subprocess.run(base+['--method','org.freedesktop.DBus.Peer.Ping'],capture_output=True)
        if ready.returncode==0: break
        time.sleep(.03)
    else: raise AssertionError('D-Bus bridge did not acquire its name')
    for method,uri in [('ShowFolders',Path.home().as_uri()),('ShowItems',Path(sys.argv[2]).as_uri()),('ShowItemProperties',Path(sys.argv[2]).as_uri())]:
        subprocess.run(base+['--method','org.freedesktop.FileManager1.'+method,str([uri]),''],check=True,capture_output=True)
    for _ in range(100):
        calls=Path.home()/'calls.jsonl'
        if calls.exists() and len(calls.read_text().splitlines())==3: break
        time.sleep(.03)
    else: raise AssertionError('Expected three launcher invocations')
finally:
    server.terminate();server.wait(timeout=5)
'''
            env = dict(os.environ, HOME=str(home), PYTHONDONTWRITEBYTECODE='1')
            result = subprocess.run(['dbus-run-session', '--', '/usr/bin/python3', '-c', harness, str(SERVICE), str(file)],
                                    env=env, text=True, capture_output=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = [json.loads(line) for line in (home / 'calls.jsonl').read_text().splitlines()]
            self.assertCountEqual(calls, [[str(home)], ['--select', str(file)], ['--properties', str(file)]])


if __name__ == '__main__':
    unittest.main()
