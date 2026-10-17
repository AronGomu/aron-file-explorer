"""Native restart checks using an isolated profile and an unfocused workspace."""
from pathlib import Path
import json, os, shlex, signal, subprocess, time, urllib.request, uuid

ROOT = Path.cwd()
fixture = ROOT / '.tmp/path-input-focus' / uuid.uuid4().hex[:8]
evidence = ROOT / 'artifacts/path-input-focus'
binary = Path(os.environ.get('EXPLR_TEST_BINARY', str(ROOT / 'target/release/src-tauri')))
source = (ROOT / 'tests/native/selection-deletion/native-check.py').read_text().split("if __name__=='__main__':")[0].replace('9234', '9235').replace("EVIDENCE=ROOT/'artifacts/selection-deletion'", "EVIDENCE=ROOT/'artifacts/path-input-focus'")
namespace = {}
exec(source, namespace)
Native = namespace['Native']
results = []
for name in ['cwd', 'data', 'config', 'cache', 'state', 'files', 'other']:
    (fixture / name).mkdir(parents=True, exist_ok=True)
for folder in ['files', 'other']:
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
    def edit_path():
        key(n, 'l', ctrlKey=True)
        n.wait('document.activeElement.matches(".path-input")')
        n.js('window.__pathInput=document.activeElement;window.__pathInput.select()')
        assert n.js('window.__pathInput.selectionEnd>window.__pathInput.selectionStart')
    def click_background(selector):
        n.js('(()=>{const e=document.querySelector('+json.dumps(selector)+');for(const type of ["pointerdown","pointerup"])e.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,button:0,pointerId:12}));e.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,detail:1}));})()')
    edit_path()
    click_background('.file-list-wrapper')
    time.sleep(.2)
    observed=n.js('({editing:!!document.querySelector(".path-input"),active:document.activeElement.className,selectionCleared:window.__pathInput.selectionStart===window.__pathInput.selectionEnd})')
    passed=not observed['editing'] and 'file-list-container' in observed['active'] and observed['selectionCleared']
    results.append({'check':'A1 Clicking file pane background clears path text selection and focuses items','passed':passed,'observed':observed})
    assert passed, observed
    key(n,'ArrowRight')
    assert n.selected()==['001.txt'],n.selected()
    results.append({'check':'A2 Arrow navigation works immediately after outside click','passed':True})
    edit_path()
    n.js('document.querySelector(".path-input").click()')
    time.sleep(.15)
    assert n.js('document.activeElement.matches(".path-input") && window.__pathInput.selectionEnd>window.__pathInput.selectionStart')
    results.append({'check':'A3 Clicking inside the path input preserves editing and selection','passed':True})
    n.js('document.querySelector(".path-input").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,pointerId:12}));document.querySelector(".file-list-wrapper").dispatchEvent(new PointerEvent("pointerup",{bubbles:true,button:0,pointerId:12}))')
    time.sleep(.15)
    assert n.js('document.activeElement.matches(".path-input") && window.__pathInput.selectionEnd>window.__pathInput.selectionStart')
    results.append({'check':'A4 Selection drag starting inside path input is not dismissed on outside release','passed':True})
    click_background('.toolbar')
    n.wait('!document.querySelector(".path-input") && document.activeElement.matches(".file-list-container")')
    results.append({'check':'A5 Clicking noninteractive toolbar space dismisses path editing','passed':True})
    edit_path()
    n.js('document.querySelector(".search-icon-btn").click()')
    n.wait('document.activeElement.matches(".path-search-input")')
    n.js('document.activeElement.click()')
    time.sleep(.15)
    assert n.js('document.activeElement.matches(".path-search-input")')
    key(n,'Escape')
    n.wait('document.activeElement.matches(".file-list-container")')
    results.append({'check':'A6 Clicking into search retains editing focus; Escape returns to items','passed':True})
    edit_path()
    n.js('document.querySelector("button[aria-label=Settings]").click()')
    n.wait('document.querySelector("[role=dialog]")!==null')
    assert n.js('document.activeElement.closest("[role=dialog]")!==null')
    key(n,'Escape')
    n.wait('document.querySelector("[role=dialog]")===null')
    results.append({'check':'A7 Outside-click button action still runs and dialog keeps focus','passed':True})
    n.screenshot('native-focus-restored.png')
    n.ws.close()
    stop()
    (fixture/'empty').mkdir()
    n=launch('empty',0)
    n.wait('document.querySelector(".empty-state-container")!==null')
    edit_path()
    click_background('.empty-state-container')
    n.wait('!document.querySelector(".path-input") && document.activeElement.matches(".file-list-container")')
    results.append({'check':'A8 Outside click returns focus to the item pane in an empty folder','passed':True})
    n.ws.close()
finally:
    stop()
    (evidence/('native-results-'+os.environ.get('EXPLR_CHECK_PHASE','green')+'.json')).write_text(json.dumps({'fixture':str(fixture),'results':results},indent=2)+'\n')
print('PASS: outside path clicks clear selection, restore navigation and preserve editable controls/dialogs.')
