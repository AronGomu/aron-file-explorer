"""Native restart checks using an isolated profile and an unfocused workspace."""
from pathlib import Path
import json, os, shlex, signal, subprocess, time, urllib.request, uuid

ROOT = Path.cwd()
fixture = ROOT / '.tmp/zoom-scroll' / uuid.uuid4().hex[:8]
evidence = ROOT / 'artifacts/zoom-scroll'
binary = Path(os.environ.get('EXPLR_TEST_BINARY', str(ROOT / 'target/release/src-tauri')))
source = (ROOT / 'tests/native/selection-deletion/native-check.py').read_text().split("if __name__=='__main__':")[0].replace('9234', '9235').replace("EVIDENCE=ROOT/'artifacts/selection-deletion'", "EVIDENCE=ROOT/'artifacts/zoom-scroll'")
namespace = {}
exec(source, namespace)
Native = namespace['Native']
results = []
for name in ['cwd', 'data', 'config', 'cache', 'state', 'files', 'other']:
    (fixture / name).mkdir(parents=True, exist_ok=True)
for folder in ['files', 'other']:
    for i in range(240):
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
            return
        time.sleep(.05)
    raise AssertionError('Native process did not stop')

def launch(folder='files'):
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
    n.wait('document.querySelectorAll(".file-item").length===240')
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
    n = launch()
    view(n, 'list')
    # Ctrl+wheel is the user's zoom gesture. Repeat while animation is running.
    n.js('(()=>{const c=document.querySelector(".file-list-container");for(let i=0;i<40;i++)c.dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-100}));})()')
    time.sleep(1.3)
    expected = scroll(n, 950, 100)
    assert expected['zoom'] > 1.9 and expected['top'] == 950, expected
    n.ws.close()
    stop()
    n = launch()
    actual = state(n)
    passed = all(abs(actual[key] - expected[key]) < .05 for key in ['zoom', 'top', 'left'])
    results.append({'check': 'A1 List Ctrl+wheel zoom and both scroll axes survive restart with first item focused offscreen', 'expected': expected, 'actual': actual, 'passed': passed})
    if os.environ.get('EXPLR_CHECK_PHASE') != 'red':
        assert passed, results[-1]
    view(n, 'grid')
    n.js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"-",ctrlKey:true,bubbles:true,cancelable:true}))')
    time.sleep(1.3)
    expected_grid = scroll(n, 1300, 0)
    n.ws.close()
    stop()
    n = launch()
    actual_grid = state(n)
    passed = all(abs(actual_grid[key] - expected_grid[key]) < .05 for key in ['zoom', 'top', 'left'])
    results.append({'check': 'A2 Icon zoom and scroll survive a second restart', 'expected': expected_grid, 'actual': actual_grid, 'passed': passed})
    if os.environ.get('EXPLR_CHECK_PHASE') != 'red':
        assert passed, results[-1]
        # Open a different directory through the location field, then navigate back.
        key(n, 'l', ctrlKey=True)
        n.wait('document.activeElement.getAttribute("aria-label")==="Path input"')
        other = str(fixture / 'other')
        n.js('(()=>{const e=document.activeElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + json.dumps(other) + ');e.dispatchEvent(new Event("input",{bubbles:true}));})()')
        key(n, 'Enter')
        n.wait('document.querySelector(".file-item")?.dataset.path.startsWith(' + json.dumps(other + '/') + ')')
        other_state = scroll(n, 600, 0)
        key(n, 'ArrowLeft', altKey=True)
        n.wait('document.querySelector(".file-item")?.dataset.path.startsWith(' + json.dumps(str(fixture / 'files') + '/') + ')')
        time.sleep(.3)
        restored = state(n)
        assert abs(restored['top'] - expected_grid['top']) < .05, restored
        key(n, 'ArrowRight', altKey=True)
        n.wait('document.querySelector(".file-item")?.dataset.path.startsWith(' + json.dumps(other + '/') + ')')
        time.sleep(.3)
        assert abs(state(n)['top'] - other_state['top']) < .05, state(n)
        results.append({'check': 'A3 Independent folder positions restore on back/forward navigation', 'passed': True})
        n.ws.close()
        stop()
        n = launch(None)
        assert n.js('document.querySelector(".file-item").dataset.path.startsWith(' + json.dumps(other + '/') + ')')
        assert abs(state(n)['top'] - other_state['top']) < .05, state(n)
        results.append({'check': 'A4 Launch with no directory argument restores the last folder and its scroll position', 'passed': True})
        # Keyboard navigation must still reveal the focused item after restoration.
        key(n, 'ArrowDown')
        time.sleep(.2)
        assert n.js('(()=>{const c=document.querySelector(".file-list-container").getBoundingClientRect(),i=document.querySelector(".file-item.focused").getBoundingClientRect();return i.top>=c.top-1&&i.bottom<=c.bottom+1;})()')
        results.append({'check': 'A5 Arrow navigation reveals the selected item after restoring an offscreen focus', 'passed': True})
        n.screenshot('native-restored.png')
    n.ws.close()
finally:
    stop()
    (evidence / ('native-results-' + os.environ.get('EXPLR_CHECK_PHASE', 'green') + '.json')).write_text(json.dumps({'fixture': str(fixture), 'results': results}, indent=2) + '\n')
assert all(result['passed'] for result in results), results
print('PASS: native zoom, per-folder scroll, restarts and keyboard navigation.')
