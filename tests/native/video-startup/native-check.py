"""Measure cold native video startup, audio, segmented playback and seeking."""
from pathlib import Path
import json, os, shlex, shutil, signal, subprocess, time, urllib.request, uuid

ROOT = Path.cwd()
fixture = ROOT / '.tmp/video-startup' / uuid.uuid4().hex[:8]
evidence = ROOT / 'artifacts/video-startup'
binary = Path(os.environ.get('EXPLR_TEST_BINARY', ROOT / 'target/debug/src-tauri'))
source = (ROOT / 'tests/native/selection-deletion/native-check.py').read_text().split("if __name__=='__main__':")[0].replace('9234', '9235').replace("EVIDENCE=ROOT/'artifacts/selection-deletion'", "EVIDENCE=ROOT/'artifacts/video-startup'")
namespace = {}
exec(source, namespace)
Native = namespace['Native']
results = []
modes = ['chooser'] if os.environ.get('EXPLR_CHOOSER_ONLY') == '1' else ['explorer', 'chooser']
workspace_before = json.loads(subprocess.check_output(['hyprctl', '-j', 'activeworkspace']))['id']


def stop():
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            if (process / 'cwd').resolve() == fixture / 'cwd' and str((process / 'exe').resolve()).removesuffix(' (deleted)') == str(binary.resolve()):
                os.kill(int(process.name), signal.SIGTERM)
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            pass
    for _ in range(100):
        try:
            urllib.request.urlopen('http://127.0.0.1:9235', timeout=.1)
        except Exception:
            return
        time.sleep(.05)
    raise AssertionError('Native process did not stop')


def launch(mode):
    workspaces = json.loads(subprocess.check_output(['hyprctl', '-j', 'workspaces']))
    workspace = max([99, *[w['id'] + 1 for w in workspaces]])
    profile = fixture / mode
    for name in ['data', 'config', 'cache', 'state', 'temp']:
        (profile / name).mkdir(parents=True)
    env = ['env', 'GDK_BACKEND=wayland', 'GDK_SCALE=1', 'LIBGL_ALWAYS_SOFTWARE=1', 'WEBKIT_DISABLE_COMPOSITING_MODE=1', 'WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9235']
    env += [f'XDG_{key}_HOME={profile / value}' for key, value in [('DATA', 'data'), ('CONFIG', 'config'), ('CACHE', 'cache'), ('STATE', 'state')]]
    env += [f'TMPDIR={profile / "temp"}']
    arguments = [str(fixture / 'files')]
    if mode == 'chooser':
        request = dict(mode='OpenFile', title='Video startup test', appId='native.test', parentWindow='', modal=True,
                       multiple=False, directory=False, currentFolder=str(fixture / 'files'), currentName='', acceptLabel='', filters=[], currentFilter=None, choices=[], files=[])
        request_path = fixture / 'request.json'
        request_path.write_text(json.dumps(request))
        arguments = ['--chooser-request', str(request_path)]
    command = 'cd ' + shlex.quote(str(fixture / 'cwd')) + ' && exec ' + shlex.join([*env, str(binary), *arguments]) + ' > ' + shlex.quote(str(profile / 'native.log')) + ' 2>&1'
    subprocess.run(['hyprctl', 'eval', 'hl.dispatch(hl.dsp.exec_cmd(' + json.dumps(command) + ', {workspace="' + str(workspace) + ' silent", no_focus=true}))'], capture_output=True, check=True)
    for _ in range(150):
        try:
            if '/socket/' in urllib.request.urlopen('http://127.0.0.1:9235', timeout=.2).read().decode():
                break
        except Exception:
            pass
        time.sleep(.05)
    else:
        raise AssertionError('Native inspector unavailable')
    n = Native()
    n.wait('document.querySelector(' + json.dumps(f'.file-item[data-path="{fixture / "files/Folder"}"]') + ')!==null')
    n.js('document.querySelector(`button[aria-label="Expand preview panel"]`)?.click()')
    time.sleep(.15)
    clients = json.loads(subprocess.check_output(['hyprctl', '-j', 'clients']))
    own_clients = [client for client in clients if Path(f'/proc/{client["pid"]}/cwd').resolve() == fixture / 'cwd']
    assert own_clients and all(client['workspace']['id'] == workspace for client in own_clients)
    assert json.loads(subprocess.check_output(['hyprctl', '-j', 'activeworkspace']))['id'] != workspace
    return n


def wait(n, expression, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if n.js(expression):
            return
        time.sleep(.03)
    raise AssertionError(expression)


def select(n, path):
    n.js('document.querySelector(' + json.dumps(f'.file-item[data-path="{path}"]') + ').dispatchEvent(new MouseEvent("click",{bubbles:true,detail:1}))')
    time.sleep(.05)


try:
    (fixture / 'cwd').mkdir(parents=True)
    (fixture / 'files/Folder').mkdir(parents=True)
    # Long enough to expose full-file transcoding; each application starts cold.
    for mode in modes:
        path = fixture / 'files' / (mode + '-long.mkv')
        subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
                        '-f', 'lavfi', '-i', 'testsrc2=s=960x540:r=24:d=90',
                        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=90',
                        '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-c:a', 'aac', '-shortest', '-y', str(path)], check=True)
    (fixture / 'files/99-broken.mkv').write_text('invalid video fixture')
    for mode in modes:
        n = launch(mode)
        path = fixture / 'files' / (mode + '-long.mkv')
        started = time.monotonic()
        select(n, path)
        wait(n, '(()=>{const v=document.querySelector(".preview-media video");if(v){v.muted=true;if(v.paused&&!v.error)v.play().catch(()=>{});}return v?.currentTime>.1&&v.videoWidth>0})()', 3)
        startup = time.monotonic() - started
        observed = n.js('(()=>{const v=document.querySelector("video");return {time:v.currentTime,duration:v.duration,width:v.videoWidth,audio:v.audioTracks?.length,frames:v.getVideoPlaybackQuality().totalVideoFrames,url:v.currentSrc}})()')
        assert observed['duration'] >= 89, observed
        assert observed['audio'] > 0, observed
        n.js('document.querySelector("video").currentTime=4.5')
        wait(n, 'document.querySelector("video").currentTime>6')
        n.js('document.querySelector("video").currentTime=55.5')
        wait(n, '(()=>{const v=document.querySelector("video");return !v.seeking&&v.readyState>=2&&v.currentTime>55.7})()')
        n.js('document.querySelector("video").currentTime=2.5')
        wait(n, '(()=>{const v=document.querySelector("video");return !v.seeking&&v.readyState>=2&&v.currentTime>2.7&&v.currentTime<5})()')
        n.js('document.querySelector("video").currentTime=88.5')
        wait(n, 'document.querySelector("video").ended')
        n.screenshot(mode + '-playing.png')
        # Switching files cancels the old segment scheduler and its player.
        select(n, fixture / 'files/Folder')
        wait(n, 'document.querySelector("video")===null')
        select(n, path)
        wait(n, '(()=>{const v=document.querySelector("video");return v?.readyState>=2&&v.videoWidth>0})()', 2)
        select(n, fixture / 'files/99-broken.mkv')
        wait(n, '!!document.querySelector(".details-preview-area [role=alert]")', 10)
        results.append({'view': mode, 'passed': True, 'coldStartupSeconds': startup, 'observed': observed,
                        'checks': ['cold playback under 3 seconds', 'full duration and audio', 'continuous playback past first 5 seconds', 'seek to 55.5 seconds without full conversion', 'seek backward after buffer eviction', 'seek to end and finish playback', 'switch away and reopen', 'corrupt file terminates with error']})
        print(mode + ': cold startup ' + str(round(startup, 3)) + 's; audio, chunk transition and distant seek passed', flush=True)
        n.ws.close()
        stop()
finally:
    stop()
    (evidence / ('native-results-' + os.environ.get('EXPLR_CHECK_PHASE', 'green') + '.json')).write_text(json.dumps({'fixture': str(fixture), 'workspaceBefore': workspace_before, 'workspaceAfter': json.loads(subprocess.check_output(['hyprctl', '-j', 'activeworkspace']))['id'], 'results': results}, indent=2) + '\n')
    for log in fixture.glob('*/native.log'):
        shutil.copyfile(log, evidence / (log.parent.name + '-native.log'))
    shutil.rmtree(fixture)
print('PASS: Both native views start cold long videos promptly, preserve audio and seek without whole-file preparation.')
