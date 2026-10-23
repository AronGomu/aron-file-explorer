"""Exercise actual video playback in native Tauri, without taking desktop focus."""
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path.cwd()
EVIDENCE = ROOT / 'artifacts/video-playback'
EVIDENCE.mkdir(parents=True, exist_ok=True)
source = (ROOT / 'tests/native/selection-deletion/native-check.py').read_text().split("if __name__=='__main__':")[0]
namespace = {}
exec(source.replace('9234', '9235').replace("EVIDENCE=ROOT/'artifacts/selection-deletion'", "EVIDENCE=ROOT/'artifacts/video-playback'"), namespace)
Native = namespace['Native']
binary = Path(os.environ.get('EXPLR_TEST_BINARY', ROOT / 'target/release/src-tauri')).resolve()
phase = os.environ.get('EXPLR_CHECK_PHASE', 'green')
results = []
process_id = None
n = None
(ROOT / '.tmp').mkdir(exist_ok=True)


def wait(n, expression, seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if n.js(expression):
            return
        time.sleep(.1)
    raise AssertionError(expression)


with tempfile.TemporaryDirectory(prefix='video-playback-', dir=ROOT / '.tmp') as temporary:
    fixture = Path(temporary)
    for name in ['cwd', 'data', 'config', 'cache', 'state', 'files', 'temp']:
        (fixture / name).mkdir()
    formats = [
        ('01.mp4', 'libx264', 'aac', 'mp4'),
        ('02 space # quote\'.MKV', 'ffv1', 'pcm_s16le', 'matroska'),
        ('03.avi', 'mpeg4', 'mp3', 'avi'),
        ('04.mov', 'prores_ks', 'pcm_s16le', 'mov'),
        ('05.webm', 'libvpx-vp9', 'libopus', 'webm'),
        ('06.wmv', 'wmv2', 'wmav2', 'asf'),
        ('07.flv', 'flv', 'mp3', 'flv'),
        ('08.mpeg', 'mpeg2video', 'mp2', 'mpeg'),
        ('09.ogv', 'libtheora', 'libvorbis', 'ogg'),
        ('10.m4v', 'libx264', 'aac', 'ipod'),
        ('11.3gp', 'h263', 'aac', '3gp'),
        ('12.MTS', 'mpeg2video', 'mp2', 'mpegts'),
        ('13.vob', 'mpeg2video', 'ac3', 'vob'),
        ('14-hevc.mp4', 'libx265', 'aac', 'mp4'),
        ('15-av1.mp4', 'libaom-av1', 'aac', 'mp4'),
        ('16-silent.webm', 'libvpx', None, 'webm'),
    ]
    if phase == 'red':
        formats = [formats[0], formats[4]]
    for name, video, audio, container in formats:
        options = ['-pix_fmt', 'yuv422p10le'] if video == 'prores_ks' else ['-pix_fmt', 'yuv420p']
        if video == 'libx265':
            options += ['-preset', 'ultrafast', '-x265-params', 'pools=1:frame-threads=1:log-level=error']
        if video == 'libaom-av1':
            options += ['-cpu-used', '8']
        audio_input = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3'] if audio else []
        audio_output = ['-c:a', audio] if audio else ['-an']
        subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
                        '-f', 'lavfi', '-i', 'testsrc2=s=128x96:r=12:d=3', *audio_input,
                        '-c:v', video, '-threads', '1', *options, *audio_output,
                        '-shortest', '-f', container, '-y', str(fixture / 'files' / name)], check=True)
    sample = os.environ.get('EXPLR_VIDEO_SAMPLE')
    if sample:
        shutil.copy2(sample, fixture / 'files/00-real.mp4')
    (fixture / 'files/99-broken.mkv').write_text('invalid video fixture')
    try:
        workspaces = json.loads(subprocess.check_output(['hyprctl', '-j', 'workspaces']))
        workspace = max([99, *[w['id'] + 1 for w in workspaces]])
        env = ['env', 'GDK_BACKEND=wayland', 'LIBGL_ALWAYS_SOFTWARE=1',
               'WEBKIT_DISABLE_COMPOSITING_MODE=1', 'GST_DEBUG=2', 'WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9235']
        env += [f'XDG_{key}_HOME={fixture / value}' for key, value in
                [('DATA', 'data'), ('CONFIG', 'config'), ('CACHE', 'cache'), ('STATE', 'state')]]
        env += [f'TMPDIR={fixture / "temp"}']
        command = ('cd ' + shlex.quote(str(fixture / 'cwd')) + ' && exec ' +
                   shlex.join([*env, str(binary), str(fixture / 'files')]) + ' > ' +
                   shlex.quote(str(fixture / 'native.log')) + ' 2>&1')
        launch = 'hl.dispatch(hl.dsp.exec_cmd(' + json.dumps(command) + ', {workspace="' + str(workspace) + ' silent", no_focus=true}))'
        output = subprocess.check_output(['hyprctl', 'eval', launch], text=True)
        assert output.strip() == 'ok', output
        for _ in range(150):
            try:
                if '/socket/' in urllib.request.urlopen('http://127.0.0.1:9235', timeout=.2).read().decode():
                    break
            except Exception:
                pass
            time.sleep(.05)
        n = Native()
        clients = json.loads(subprocess.check_output(['hyprctl', '-j', 'clients']))
        own = [c for c in clients if Path(f'/proc/{c["pid"]}/cwd').resolve() == fixture / 'cwd']
        assert own and all(c['workspace']['id'] == workspace for c in own), own
        process_id = own[0]['pid']
        wait(n, 'document.querySelectorAll(".file-item").length===' + str(len(formats) + 1 + bool(sample)), 20)
        n.js('document.querySelector(' + json.dumps('button[aria-label="Expand preview panel"]') + ')?.click()')
        names = (['00-real.mp4'] if sample else []) + [row[0] for row in formats]
        for name in names:
            path = str(fixture / 'files' / name)
            select = 'Array.from(document.querySelectorAll(".file-item")).find(e=>e.dataset.path===' + json.dumps(path) + ').dispatchEvent(new MouseEvent("click",{bubbles:true,detail:1}))'
            n.js(select)
            time.sleep(.1)
            if n.selected() != [name]:
                n.js(select)
                time.sleep(.1)
            assert n.selected() == [name], n.selected()
            wait(n, '!!document.querySelector(".preview-media video")', 20)
            try:
                wait(n, '(()=>{const v=document.querySelector(".preview-media video");if(v){v.muted=true;if(v.paused&&!v.error)v.play().catch(()=>{});}return v?.currentTime>.25||!!document.querySelector(".details-preview-area [role=alert]")})()', 10 if phase == 'red' else 20)
            except AssertionError:
                pass
            observed = n.js('(()=>{const v=document.querySelector(".preview-media video");return {ready:v?.readyState,error:v?.error?.code,message:v?.error?.message,width:v?.videoWidth,time:v?.currentTime,duration:v?.duration,audio:v?.audioTracks?.length,frames:v?.getVideoPlaybackQuality?.().totalVideoFrames,url:v?.currentSrc,alert:document.querySelector(".details-preview-area [role=alert]")?.textContent}})()')
            if observed.get('error') or not observed.get('width') or observed.get('time', 0) <= .25:
                results.append({'name': name, 'passed': False, 'observed': observed})
                print(name + ': FAIL ' + json.dumps(observed), flush=True)
                continue
            n.js('(()=>{const v=document.querySelector(".preview-media video");v.pause();v.currentTime=1.5})()')
            try:
                wait(n, '(()=>{const v=document.querySelector(".preview-media video");return !v.seeking&&v.currentTime>=1.4})()', 10)
            except AssertionError:
                results.append({'name': name, 'passed': False, 'observed': observed, 'seekFailed': True})
                print(name + ': FAIL seeking ' + json.dumps(observed), flush=True)
                continue
            assert bool(observed.get('audio', 1)) == (name != '16-silent.webm'), observed
            assert observed.get('frames', 1) > 0, observed
            results.append({'name': name, 'passed': True, 'observed': observed, 'playbackAndSeek': True})
            if name == '00-real.mp4':
                n.screenshot('real-mp4-playing.png')
            print(name + ': ' + ('PASS' if results[-1]['passed'] else 'FAIL'), flush=True)
        if phase != 'red':
            path = str(fixture / 'files/99-broken.mkv')
            n.js('Array.from(document.querySelectorAll(".file-item")).find(e=>e.dataset.path===' + json.dumps(path) + ').dispatchEvent(new MouseEvent("click",{bubbles:true,detail:1}))')
            wait(n, '!!document.querySelector(".details-preview-area [role=alert]")')
            results.append({'name': 'corrupt video reports an error', 'passed': True})
    finally:
        if n:
            try:
                (EVIDENCE / ('page-' + phase + '.json')).write_text(json.dumps(n.js('({url:location.href,body:document.body.innerText.slice(-2500)})'), indent=2))
            except Exception:
                pass
            n.ws.close()
        if not process_id:
            for process in Path('/proc').iterdir():
                if not process.name.isdigit():
                    continue
                try:
                    if (process / 'cwd').resolve() == fixture / 'cwd' and (process / 'exe').resolve() == binary:
                        process_id = int(process.name)
                        break
                except (FileNotFoundError, PermissionError):
                    pass
        if process_id:
            try:
                os.kill(process_id, signal.SIGTERM)
            except ProcessLookupError:
                pass
            for _ in range(100):
                if not Path(f'/proc/{process_id}').exists():
                    break
                time.sleep(.05)
        (EVIDENCE / ('native-results-' + phase + '.json')).write_text(json.dumps(results, indent=2) + '\n')
        if (fixture / 'native.log').exists():
            (EVIDENCE / ('native-' + phase + '.log')).write_text((fixture / 'native.log').read_text())
assert results and all(result['passed'] for result in results), results
print('PASS: native video playback, seeking, real MP4 sample, common formats and corrupt-file fallback.')
