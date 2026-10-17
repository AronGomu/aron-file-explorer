"""Native restart checks using an isolated profile and an unfocused workspace."""
from pathlib import Path
import json, os, shlex, signal, subprocess, time, urllib.request, uuid

ROOT = Path.cwd()
fixture = ROOT / '.tmp/drag-move' / uuid.uuid4().hex[:8]
evidence = ROOT / 'artifacts/drag-move'
binary = Path(os.environ.get('EXPLR_TEST_BINARY', str(ROOT / 'target/release/src-tauri')))
source = (ROOT / 'tests/native/selection-deletion/native-check.py').read_text().split("if __name__=='__main__':")[0].replace('9234', '9235').replace("EVIDENCE=ROOT/'artifacts/selection-deletion'", "EVIDENCE=ROOT/'artifacts/drag-move'")
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


def item(n, name):
    return 'Array.from(document.querySelectorAll(".file-item")).find(e=>e.dataset.path.endsWith('+json.dumps('/'+name)+'))'

def click(n, name, ctrl=False):
    n.js(item(n,name)+'.dispatchEvent(new MouseEvent("click",{bubbles:true,detail:1,ctrlKey:'+str(ctrl).lower()+'}))')
    time.sleep(.1)

def begin(n, name):
    n.js('window.__source='+item(n,name)+';window.__drag=new DataTransfer();window.__down=new MouseEvent("mousedown",{bubbles:true,cancelable:true,button:0});window.__source.dispatchEvent(window.__down);window.__start=new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:window.__drag});window.__source.dispatchEvent(window.__start)')
    observed=n.js('({draggable:window.__source.draggable,mouseDownPrevented:window.__down.defaultPrevented,canceled:window.__start.defaultPrevented,types:Array.from(window.__drag.types)})')
    assert observed['draggable'] and not observed['mouseDownPrevented'] and not observed['canceled'],observed
    assert 'application/x-explr-selection' in observed['types'],observed
    time.sleep(.1)

def target(n, selector):
    n.js('window.__target='+selector+';window.__over=new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:window.__drag});window.__target.dispatchEvent(window.__over)')
    time.sleep(.1)
    return n.js('({accepted:window.__over.defaultPrevented,active:window.__target.dataset.fileDropActive==="true"})')

def finish(n, drop=True):
    n.js(('window.__target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:window.__drag}));' if drop else '')+'window.__source.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:window.__drag}))')
    n.wait('document.querySelectorAll("[data-file-drag-source=true], [data-file-drop-active=true]").length===0')
    time.sleep(.25)

def wait_moved(source, destination):
    for _ in range(150):
        if not source.exists() and destination.exists(): return
        time.sleep(.05)
    raise AssertionError(f'Not moved: {source} → {destination}')

try:
    for mode in ['grid','list']:
        folder=fixture/mode
        folder.mkdir()
        (folder/'Target').mkdir()
        (folder/'Target/f.txt').write_text('existing content')
        for name in 'abcdefgh': (folder/(name+'.txt')).write_text(mode+'-'+name)
        sidebar=fixture/'other'/mode
        sidebar.mkdir()
        n=launch(mode,count=9)
        view(n,mode)
        n.js('localStorage.setItem("fileExplorerFavorites",'+json.dumps(json.dumps([{'name':'Drop destination','path':str(sidebar),'icon':'folder'}]))+');window.dispatchEvent(new Event("favorites-updated"))')
        n.js('Array.from(document.querySelectorAll("button")).find(e=>e.getAttribute("aria-label")==="Expand Favorites")?.click()')
        n.wait('Array.from(document.querySelectorAll(".sidebar-item")).some(e=>e.dataset.fileDropPath==='+json.dumps(str(sidebar))+')')
        # Preserve existing Shift keyboard range selection.
        click(n,'a.txt'); key(n,'ArrowRight',shiftKey=True)
        assert n.selected()==['a.txt','b.txt'],n.selected()
        key(n,'ArrowLeft',shiftKey=True)
        assert n.selected()==['a.txt'],n.selected()
        click(n,'b.txt',ctrl=True)
        begin(n,'b.txt')
        assert n.selected()==['a.txt','b.txt'],n.selected()
        assert n.js('document.querySelectorAll("[data-file-drag-source=true]").length')==2
        state=target(n,item(n,'Target'))
        assert state=={'accepted':True,'active':True},state
        n.screenshot(mode+'-folder-drop-highlight.png')
        finish(n)
        for name in ['a.txt','b.txt']: wait_moved(folder/name,folder/'Target'/name)
        n.wait('document.querySelectorAll(".file-item").length===7')
        assert not set(n.selected()).intersection({"a.txt","b.txt"}),n.selected()
        results.append(mode+': selected pair moves together into a visible folder; Shift range expands/shrinks')
        # Dragging an unselected entry replaces the previous selection and moves alone.
        click(n,'d.txt')
        begin(n,'c.txt')
        assert n.selected()==['c.txt'],n.selected()
        destination=fixture/('c-'+mode+'.txt')
        # Root fixture is a safe ancestor breadcrumb; use original name and rename fixture after verification.
        selector='Array.from(document.querySelectorAll(".segment-button")).find(e=>e.dataset.fileDropPath==='+json.dumps(str(fixture))+')'
        assert target(n,selector)['accepted']
        finish(n)
        wait_moved(folder/'c.txt',fixture/'c.txt')
        (fixture/'c.txt').rename(destination)
        assert (folder/'d.txt').exists()
        n.wait('document.querySelectorAll(".file-item").length===6')
        results.append(mode+': unselected item moves alone to ancestor breadcrumb')
        click(n,'d.txt'); click(n,'e.txt',ctrl=True)
        begin(n,'d.txt')
        selector='Array.from(document.querySelectorAll(".sidebar-item")).find(e=>e.dataset.fileDropPath==='+json.dumps(str(sidebar))+')'
        assert target(n,selector)=={'accepted':True,'active':True}
        n.screenshot(mode+'-sidebar-drop-highlight.png')
        finish(n)
        for name in ['d.txt','e.txt']: wait_moved(folder/name,sidebar/name)
        n.wait('document.querySelectorAll(".file-item").length===4')
        results.append(mode+': selected pair moves to sidebar favorite')
        # Existing target must survive unchanged; failed moves release processing state.
        begin(n,'f.txt'); assert target(n,item(n,'Target'))['accepted']; finish(n)
        n.wait('document.body.innerText.includes("already exists in the destination")')
        assert (folder/'f.txt').read_text()==mode+'-f'
        assert (folder/'Target/f.txt').read_text()=='existing content'
        begin(n,'g.txt'); assert target(n,item(n,'Target'))['accepted']; finish(n)
        wait_moved(folder/'g.txt',folder/'Target/g.txt')
        n.wait('document.querySelectorAll(".file-item").length===3')
        results.append(mode+': conflict leaves both files intact and next move succeeds')
        # A folder cannot target itself, and current breadcrumb is a no-op.
        begin(n,'Target')
        assert target(n,item(n,'Target'))=={'accepted':False,'active':False}
        selector='Array.from(document.querySelectorAll(".segment-button")).find(e=>e.dataset.fileDropPath==='+json.dumps(str(folder))+')'
        assert target(n,selector)=={'accepted':False,'active':False}
        finish(n,drop=False)
        assert (folder/'Target/a.txt').exists()
        # Cancel a highlighted drag and verify keyboard focus returns to pane.
        begin(n,'h.txt'); assert target(n,item(n,'Target'))['active']; finish(n,drop=False)
        assert (folder/'h.txt').exists()
        n.wait('document.activeElement.classList.contains("file-list-container")')
        key(n,'ArrowLeft',shiftKey=True)
        assert n.selected()==['f.txt','h.txt'],n.selected()
        results.append(mode+': invalid/no-op drops rejected; cancel clears highlight and restores keyboard navigation')
        # Empty-space pointer selection still uses a rectangle, never file dragging.
        n.js(r'(()=>{const c=document.querySelector(".file-list-container"),r=c.getBoundingClientRect();c.setPointerCapture=()=>{};c.hasPointerCapture=()=>false;const items=Array.from(document.querySelectorAll(".file-item"),e=>e.getBoundingClientRect());const bottom=Math.max(...items.map(r=>r.bottom));const startY=Math.min(r.bottom-4,bottom+20);for(const [type,x,y] of [["pointerdown",r.right-4,startY],["pointermove",r.left+4,r.top+35]])c.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:"mouse",button:0,pointerId:19,clientX:x,clientY:y}));})()')
        time.sleep(.1)
        assert n.js('document.querySelector(".file-selection-region")!==null'), 'rectangle missing'
        assert n.js('document.querySelectorAll(".file-item.selected").length')>=2,n.selected()
        n.js('(()=>{const c=document.querySelector(".file-list-container");c.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerType:"mouse",button:0,pointerId:19}));delete c.setPointerCapture;delete c.hasPointerCapture;})()')
        results.append(mode+': empty-space rectangle selection preserved')
        n.ws.close(); stop()
    print(json.dumps(results,indent=2))
finally:
    stop()
    (evidence/('native-results-'+os.environ.get('EXPLR_CHECK_PHASE','green')+'.json')).write_text(json.dumps({'fixture':str(fixture),'results':results},indent=2)+'\n')
