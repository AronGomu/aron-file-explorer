"""Native restart checks using an isolated profile and an unfocused workspace."""
from pathlib import Path
import json, os, shlex, signal, subprocess, tempfile, time, urllib.request, uuid

ROOT = Path.cwd()
fixture = ROOT / '.tmp/video-thumbnails' / uuid.uuid4().hex[:8]
evidence = ROOT / 'artifacts/video-thumbnails'
binary = Path(os.environ.get('EXPLR_TEST_BINARY', str(ROOT / 'target/release/src-tauri')))
source = (ROOT / 'tests/native/selection-deletion/native-check.py').read_text().split("if __name__=='__main__':")[0].replace('9234', '9235').replace("EVIDENCE=ROOT/'artifacts/selection-deletion'", "EVIDENCE=ROOT/'artifacts/video-thumbnails'")
namespace = {}
exec(source, namespace)
Native = namespace['Native']
results = []
runtime_cache = tempfile.TemporaryDirectory(prefix='explr-video-thumbnail-runtime-')
for name in ['cwd','data','config','cache','state','files','temp']:
    (fixture/name).mkdir(parents=True,exist_ok=True)
formats=[('00.mp4','libx264','mp4'),('01 space # quote".MKV','ffv1','matroska'),('02.avi','mpeg4','avi'),('03.mov','mpeg4','mov'),('04.webm','libvpx-vp9','webm'),('05.wmv','wmv2','asf'),('06.flv','flv','flv'),('07.mpeg','mpeg2video','mpeg'),('08.ogv','libtheora','ogg'),('09.m4v','libx264','ipod'),('10.3gp','h263','3gp'),('11.MTS','mpeg2video','mpegts'),('12.vob','mpeg2video','vob')]
colors=['red','lime','blue','yellow','magenta','cyan']
for index,(name,codec,container) in enumerate(formats):
    duration='2' if index==0 else '0.24'
    subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i',f'color=c={colors[index%len(colors)]}:s=128x96:d={duration}','-an','-c:v',codec,'-threads','1','-f',container,'-y',str(fixture/'files'/name)],check=True)
(fixture/'files/99-broken.mkv').write_text('invalid video fixture')
(fixture/'files/plain.txt').write_text('thumbnail fixture')
subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=96x64','-frames:v','1','-threads','1','-y',str(fixture/'files/still.png')],check=True)

def stop():
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            if (process / 'cwd').resolve() == fixture / 'cwd' and (process / 'exe').resolve() == binary.resolve():
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

def launch(folder='files', count=16):
    workspaces = json.loads(subprocess.check_output(['hyprctl', '-j', 'workspaces']))
    workspace = max([99, *[w['id'] + 1 for w in workspaces]])
    env = ['env', 'GDK_BACKEND=wayland', 'GDK_SCALE=1', 'LIBGL_ALWAYS_SOFTWARE=1', 'WEBKIT_DISABLE_COMPOSITING_MODE=1', 'WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9235']
    env += [f'XDG_{key}_HOME={fixture / value}' for key, value in [('DATA', 'data'), ('CONFIG', 'config'), ('CACHE', 'cache'), ('STATE', 'state')]]
    env.append(f'TMPDIR={runtime_cache.name}')
    arguments = [str(fixture / folder)] if folder else []
    command = 'cd ' + shlex.quote(str(fixture / 'cwd')) + ' && exec ' + shlex.join([*env, str(binary), *arguments]) + ' > ' + shlex.quote(str(fixture / 'native.log')) + ' 2>&1'
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
    n.wait('document.querySelectorAll(".file-item").length==='+str(count))
    time.sleep(.3)
    clients = json.loads(subprocess.check_output(['hyprctl', '-j', 'clients']))
    own_clients = [c for c in clients if Path(f'/proc/{c["pid"]}/cwd').resolve() == fixture / 'cwd']
    assert own_clients and all(c['workspace']['id'] == workspace for c in own_clients)
    return n

def view(n, mode):
    label = 'List view' if mode == 'list' else 'Icons view'
    n.js('document.querySelector(' + json.dumps(f'button[aria-label="{label}"]') + ').click()')
    n.wait('document.querySelector(".view-mode-' + mode + '")!==null')
    time.sleep(.2)

def state(n):
    return n.js('(()=>{const c=document.querySelector(".file-list-container");return {zoom:Number(c.style.getPropertyValue("--file-grid-zoom")),top:c.scrollTop,left:c.scrollLeft,maxTop:c.scrollHeight-c.clientHeight,maxLeft:c.scrollWidth-c.clientWidth}})()')

def scroll(n, top, left):
    n.js('(()=>{const c=document.querySelector(".file-list-container");c.scrollTop=' + str(top) + ';c.scrollLeft=' + str(left) + ';})()')
    time.sleep(.3)
    return state(n)

def key(n, value, **modifiers):
    n.js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",' + json.dumps(dict(key=value, bubbles=True, cancelable=True, **modifiers)) + '))')
    time.sleep(.1)

try:
    n=launch()
    for mode in ['grid','list']:
        view(n,mode)
        loaded='Array.from(document.querySelectorAll(".file-item"),e=>({name:e.dataset.path.split("/").at(-1),image:!!e.querySelector("img.file-thumbnail")?.naturalWidth,video:!!e.querySelector(".file-icon-video"),icon:!!e.querySelector(".file-icon svg")}))'
        if os.environ.get('EXPLR_CHECK_PHASE')!='red':
            n.wait('document.querySelectorAll(".file-icon-video img.file-thumbnail").length===13')
            n.wait('Array.from(document.querySelectorAll(".file-icon-video img.file-thumbnail")).every(e=>e.complete&&e.naturalWidth>0)')
        time.sleep(.5)
        observed=n.js(loaded)
        names={name for name,_,_ in formats}
        passed=all(next(item for item in observed if item['name']==name)['image'] for name in names)
        results.append({'check':f'A1 {mode}: all 13 video formats have loaded still-image thumbnails','passed':passed,'observed':observed})
        if os.environ.get('EXPLR_CHECK_PHASE')!='red':
            assert passed,observed
            assert next(item for item in observed if item['name']=='99-broken.mkv')['icon']
            assert not next(item for item in observed if item['name']=='99-broken.mkv')['image']
            assert next(item for item in observed if item['name']=='still.png')['image']
            assert next(item for item in observed if item['name']=='plain.txt')['icon']
            results.append({'check':f'A2 {mode}: corrupt-video fallback, ordinary image and text icon remain usable','passed':True})
            n.screenshot('native-'+mode+'.png')
    if os.environ.get('EXPLR_CHECK_PHASE')!='red':
        n.click_item(0)
        if n.selected()!=[formats[0][0]]:
            n.click_item(0)
        key(n,'ArrowDown')
        assert n.selected()==[formats[1][0]],n.selected()
        results.append({'check':'A3 List file selection and arrow navigation remain functional','passed':True})
        path=str(fixture/'files'/formats[0][0])
        n.js('window.__thumbnailPaths=[];Promise.all([1,2].map(()=>window.__TAURI_INTERNALS__.invoke("get_video_thumbnail",{path:'+json.dumps(path)+',size:256}))).then(paths=>window.__thumbnailPaths=paths)')
        n.wait('window.__thumbnailPaths.length===2')
        cached=n.js('window.__thumbnailPaths')
        assert cached[0]==cached[1] and Path(cached[0]).is_file(),cached
        original=Path(cached[0]).read_bytes()
        old_source=n.js('document.querySelector(".file-item img.file-thumbnail").src')
        subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=lime:s=192x128:d=0.3','-an','-c:v','libx264','-threads','1','-y',path],check=True)
        key(n,'F5')
        n.wait('(()=>{const i=document.querySelector(".file-item img.file-thumbnail");return i?.complete&&i.naturalWidth>0&&i.src!=='+json.dumps(old_source)+';})()')
        time.sleep(.5)
        n.js('window.__changedThumb=null;window.__TAURI_INTERNALS__.invoke("get_video_thumbnail",{path:'+json.dumps(path)+',size:256}).then(path=>window.__changedThumb=path)')
        n.wait('window.__changedThumb!==null')
        changed=n.js('window.__changedThumb')
        assert changed!=cached[0] and Path(changed).read_bytes()!=original
        results.append({'check':'A4 Repeated thumbnail requests reuse cache; changed source yields a new frame','passed':True})
    n.ws.close()
except Exception:
    if 'n' in locals():
        try:
            diagnostic=n.js('Array.from(document.querySelectorAll(".file-item"),e=>({name:e.dataset.path.split("/").at(-1),image:!!e.querySelector("img.file-thumbnail")?.naturalWidth,src:e.querySelector("img.file-thumbnail")?.src,video:!!e.querySelector(".file-icon-video"),height:e.getBoundingClientRect().height,top:e.getBoundingClientRect().top}))')
            results.append({'check':'Failure diagnostics','items':diagnostic,'passed':False})
            n.screenshot('native-failure.png')
        except Exception:
            pass
    raise
finally:
    stop()
    runtime_cache.cleanup()
    (evidence/('native-results-'+os.environ.get('EXPLR_CHECK_PHASE','green')+'.json')).write_text(json.dumps({'fixture':str(fixture),'results':results},indent=2)+'\n')
assert all(result['passed'] for result in results),results
print('PASS: native video thumbnails in icon/list views, fallback, image regression, selection and cache invalidation.')
