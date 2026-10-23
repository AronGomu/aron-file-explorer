"""Native immediate file hover details and shared media duration checks."""
from pathlib import Path
import json, os, shlex, signal, subprocess, time, urllib.request, uuid

ROOT = Path.cwd()
fixture = ROOT / '.tmp/hover-details' / uuid.uuid4().hex[:8]
evidence = ROOT / 'artifacts/hover-details'
binary = Path(os.environ.get('EXPLR_TEST_BINARY', str(ROOT / 'target/release/src-tauri')))
source = (ROOT / 'tests/native/selection-deletion/native-check.py').read_text().split("if __name__=='__main__':")[0].replace('9234', '9235').replace("EVIDENCE=ROOT/'artifacts/selection-deletion'", "EVIDENCE=ROOT/'artifacts/hover-details'")
namespace = {}
exec(source, namespace)
Native = namespace['Native']
results = []
for name in ['cwd', 'data', 'config', 'cache', 'state', 'files']:
    (fixture / name).mkdir(parents=True, exist_ok=True)
for folder in ['files']:
    for i in range(3):
        (fixture / folder / f'{i:03}.txt').write_text('scroll fixture\n')

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
            # Allow WebKit children to finish flushing the disposable profile.
            time.sleep(.5)
            return
        time.sleep(.05)
    raise AssertionError('Native process did not stop')

def launch(folder='files', count=3):
    workspaces = json.loads(subprocess.check_output(['hyprctl', '-j', 'workspaces']))
    workspace = max([99, *[w['id'] + 1 for w in workspaces]])
    env = ['env', 'GDK_BACKEND=wayland', 'GDK_SCALE=1', 'LIBGL_ALWAYS_SOFTWARE=1', 'WEBKIT_DISABLE_COMPOSITING_MODE=1', 'WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9235']
    env += [f'XDG_{key}_HOME={fixture / value}' for key, value in [('DATA', 'data'), ('CONFIG', 'config'), ('CACHE', 'cache'), ('STATE', 'state')]]
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

import shutil
subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3.2', '-c:a', 'libmp3lame', str(fixture / 'files/audio.mp3')], check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=4.2', '-c:v', 'libx264', '-an', str(fixture / 'files/video.mp4')], check=True)
(fixture / 'files/broken.mp3').write_text('not audio')

def item_selector(name):
    return json.dumps('.file-item[data-path="' + str(fixture / 'files' / name) + '"]')

def hover(n, name, edge=False):
    n.js('document.querySelector(' + item_selector(name) + ').dispatchEvent(new MouseEvent("mouseover",{bubbles:true,clientX:' + ('innerWidth-4' if edge else '100') + ',clientY:' + ('innerHeight-4' if edge else '200') + '}))')

def leave(n, name):
    n.js('document.querySelector(' + item_selector(name) + ').dispatchEvent(new MouseEvent("mouseout",{bubbles:true,relatedTarget:document.body}))')

def click(n, name):
    if n.selected() != [name]:
        n.js('document.querySelector(' + item_selector(name) + ').dispatchEvent(new MouseEvent("click",{bubbles:true,detail:1}))')
        n.wait('document.querySelector(".file-item.selected")?.dataset.path===' + json.dumps(str(fixture / 'files' / name)))

try:
    n = launch(count=6)
    for mode in ['grid', 'list']:
        view(n, mode)
        click(n, '000.txt')
        n.js('document.querySelector(`button[aria-label="Expand preview panel"]`)?.click()')
        n.wait('document.querySelector("textarea.preview-text-editor")!==null')
        n.js('document.querySelector("textarea.preview-text-editor").focus()')
        before = n.selected()
        start = time.monotonic()
        hover(n, '001.txt', edge=True)
        assert n.js('document.querySelector(".file-item-tooltip")!==null'), 'Hover details did not appear immediately'
        elapsed = (time.monotonic() - start) * 1000
        text = n.js('document.querySelector(".file-item-tooltip").textContent')
        assert all(value in text for value in ['001.txt', 'Type:', 'Size:', 'Modified:', 'Location:'])
        assert n.js('document.activeElement.matches("textarea.preview-text-editor")')
        assert n.selected() == before
        rect = n.js('(()=>{const r=document.querySelector(".file-item-tooltip").getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()')
        assert rect['left'] >= 0 and rect['top'] >= 0 and rect['right'] <= rect['width'] and rect['bottom'] <= rect['height'], rect
        assert n.js('getComputedStyle(document.querySelector(".file-item-tooltip")).pointerEvents') == 'none'
        n.screenshot(mode + '-immediate-details.png')
        leave(n, '001.txt')
        assert n.js('document.querySelector(".file-item-tooltip")===null')
        results.append({'check': mode + ': immediate hover details retain selection/focus and stay inside viewport', 'passed': True, 'observedMilliseconds': round(elapsed, 1)})
        for name, duration in [('audio.mp3', '0:03'), ('video.mp4', '0:04')]:
            hover(n, name)
            n.wait('document.querySelector(".file-item-tooltip")?.textContent.includes(' + json.dumps('Duration: ' + duration) + ')')
            assert n.selected() == before
            n.screenshot(mode + '-' + name + '-hover.png')
            click(n, name)
            n.wait('document.querySelector(".details-panel-footer").textContent.includes(' + json.dumps('Duration ' + duration) + ')')
            n.js('document.querySelector(`button[aria-label="Show information"]`)?.click()')
            n.wait('document.querySelector(".details-information")?.textContent.includes(' + json.dumps('Duration:' + duration) + ')')
            n.screenshot(mode + '-' + name + '-details.png')
            before = n.selected()
            results.append({'check': mode + ': ' + name + ' duration matches hover, footer and information section', 'passed': True})
        hover(n, 'broken.mp3')
        n.wait('document.querySelector(".file-item-tooltip")?.textContent.includes("Duration: Unavailable")')
        n.js('window.dispatchEvent(new Event("scroll"))')
        assert n.js('document.querySelector(".file-item-tooltip")===null')
        results.append({'check': mode + ': unreadable media remains usable; scrolling dismisses hover', 'passed': True})
    clients = json.loads(subprocess.check_output(['hyprctl', '-j', 'clients']))
    active = json.loads(subprocess.check_output(['hyprctl', '-j', 'activeworkspace']))['id']
    assert all(c['workspace']['id'] != active for c in clients if Path(f'/proc/{c["pid"]}/cwd').resolve() == fixture / 'cwd')
    n.ws.close()
except Exception as error:
    results.append({'check': 'native hover details', 'passed': False, 'error': str(error)})
    raise
finally:
    stop()
    (evidence / ('native-results-' + os.environ.get('EXPLR_CHECK_PHASE', 'green') + '.json')).write_text(json.dumps(results, indent=2) + '\n')
    shutil.copyfile(fixture / 'native.log', evidence / 'native.log')
    shutil.rmtree(fixture)
print('PASS: native immediate hover details, audio/video durations in tooltip and preview, focus preservation and viewport positioning.')
