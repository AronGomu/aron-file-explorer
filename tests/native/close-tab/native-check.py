"""Native restart checks using an isolated profile and an unfocused workspace."""
from pathlib import Path
import json, os, shlex, signal, subprocess, time, urllib.request, uuid

ROOT = Path.cwd()
fixture = ROOT / '.tmp/close-tab' / uuid.uuid4().hex[:8]
evidence = ROOT / 'artifacts/close-tab'
binary = Path(os.environ.get('EXPLR_TEST_BINARY', str(ROOT / 'target/release/src-tauri')))
source = (ROOT / 'tests/native/selection-deletion/native-check.py').read_text().split("if __name__=='__main__':")[0].replace('9234', '9235').replace("EVIDENCE=ROOT/'artifacts/selection-deletion'", "EVIDENCE=ROOT/'artifacts/close-tab'")
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
    n=launch()
    def session():return n.js('JSON.parse(localStorage.getItem("fileExplorerSession"))')
    def count():return n.js('document.querySelectorAll(".tab-list > .tab").length')
    def create():
        key(n,'t',ctrlKey=True)
        time.sleep(.15)
    def close():
        key(n,'w',ctrlKey=True)
        time.sleep(.15)
    create()
    before=session()
    key(n,'l',ctrlKey=True)
    n.wait('document.activeElement.matches(".path-input")')
    n.js('(()=>{const e=document.activeElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,e.value+"/not-submitted");e.dispatchEvent(new Event("input",{bubbles:true}));})()')
    close()
    observed={'beforeTabs':len(before['tabs']),'afterTabs':count(),'active':n.js('document.activeElement.className')}
    passed=count()==1 and session()['activeTabId']==before['tabs'][0]['id']
    results.append({'check':'A1 Ctrl+W closes the active tab while the path input is focused','passed':passed,'observed':observed})
    assert passed,observed
    assert session()['tabs'][0]['path']==before['tabs'][0]['path']
    n.wait('document.activeElement.matches(".file-list-container")')
    create()
    key(n,'f',ctrlKey=True)
    n.wait('document.activeElement.matches(".path-search-input")')
    close()
    assert count()==1,count()
    n.wait('document.activeElement.matches(".file-list-container")')
    results.append({'check':'A2 Ctrl+W closes active tab from search and returns focus to items','passed':True})
    create()
    n.js('document.querySelector("button[aria-label=Settings]").click()')
    n.wait('document.querySelector("[role=dialog]")!==null')
    close()
    assert count()==2,count()
    key(n,'Escape')
    n.wait('document.querySelector("[role=dialog]")===null')
    key(n,'w',ctrlKey=True,repeat=True)
    assert count()==2
    key(n,'w',ctrlKey=True,shiftKey=True)
    key(n,'w',ctrlKey=True,altKey=True)
    assert count()==2
    results.append({'check':'A3 Dialogs, repeat events and unrelated modifier combinations do not close tabs','passed':True})
    # Existing Ctrl+T typing guard stays intact; unmodified W remains text input.
    key(n,'l',ctrlKey=True)
    key(n,'t',ctrlKey=True)
    assert count()==2
    key(n,'w')
    assert count()==2 and n.js('document.activeElement.matches(".path-input")')
    key(n,'Escape')
    results.append({'check':'A4 Ctrl+T input protection and unmodified typing are preserved','passed':True})
    create()
    before=session()
    # Close the middle tab, then verify its right-hand neighbor survives and becomes active.
    n.js('document.querySelectorAll(".tab-list > .tab")[1].click()')
    time.sleep(.15)
    close()
    current=session()
    assert len(current['tabs'])==2 and current['activeTabId']==before['tabs'][2]['id'],current
    assert [t['id'] for t in current['tabs']]==[before['tabs'][0]['id'],before['tabs'][2]['id']],current
    n.js('document.querySelector('+json.dumps('button[aria-label="List view"]')+').focus()')
    close()
    assert count()==1
    results.append({'check':'A5 Active middle/rightmost tab closes correctly from tabs and toolbar controls','passed':True})
    last=session()
    n.screenshot('native-last-tab.png')
    # Native close can tear down the inspector before Runtime.evaluate replies.
    try:close()
    except Exception:pass
    for _ in range(120):
        clients=json.loads(subprocess.check_output(['hyprctl','-j','clients']))
        if not any(Path(f'/proc/{c["pid"]}/cwd').resolve()==fixture/'cwd' for c in clients):break
        time.sleep(.05)
    else:raise AssertionError('Ctrl+W did not close the last native window')
    results.append({'check':'A6 Ctrl+W on the final tab closes the actual native window','passed':True})
    try:n.ws.close()
    except Exception:pass
    stop()
    n=launch(None)
    assert count()==1 and session()['tabs'][0]['path']==last['tabs'][0]['path'],session()
    results.append({'check':'A7 Reopening the app restores the last folder after final-tab closure','passed':True})
    n.ws.close()
finally:
    stop()
    (evidence/('native-results-'+os.environ.get('EXPLR_CHECK_PHASE','green')+'.json')).write_text(json.dumps({'fixture':str(fixture),'results':results},indent=2)+'\n')
print('PASS: Ctrl+W active-tab closing from inputs/buttons, modal/repeat protection and final-window close/reopen.')
