"""Native pane focus and numbered navigation checks without using the cursor."""
from pathlib import Path
import json, os, shlex, signal, subprocess, time, urllib.request, uuid

ROOT = Path.cwd()
fixture = ROOT / '.tmp/focus-shortcuts' / uuid.uuid4().hex[:8]
evidence = ROOT / 'artifacts/focus-shortcuts'
binary = Path(os.environ.get('EXPLR_TEST_BINARY', str(ROOT / 'target/release/src-tauri')))
source = (ROOT / 'tests/native/selection-deletion/native-check.py').read_text().split("if __name__=='__main__':")[0].replace('9234', '9235').replace("EVIDENCE=ROOT/'artifacts/selection-deletion'", "EVIDENCE=ROOT/'artifacts/focus-shortcuts'")
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

def key(n, value, **modifiers):
    n.js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",' + json.dumps(dict(key=value, bubbles=True, cancelable=True, **modifiers)) + '))')
    time.sleep(.1)

def check(label, run):
    try:
        run()
        results.append({'check': label, 'passed': True})
    except Exception as error:
        results.append({'check': label, 'passed': False, 'error': str(error)})

try:
    n = launch()
    n.js("window.externalOpens=[];const originalInvoke=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=(command,args,...rest)=>{if(command==='open_in_default_app'){externalOpens.push(args.path);return Promise.resolve()}return originalInvoke(command,args,...rest)}")
    def focus_preview():
        n.js('document.querySelector(`button[aria-label="Collapse preview panel"]`)?.click()')
        n.wait('document.querySelector(`button[aria-label="Expand preview panel"]`)!==null')
        for mode in ['list', 'grid']:
            view(n, mode)
            selector = json.dumps('.file-item[data-path="' + str(fixture / 'files/000.txt') + '"]')
            n.js('(()=>{const e=document.querySelector(' + selector + ');e.dispatchEvent(new MouseEvent("click",{bubbles:true,detail:1}));e.dispatchEvent(new MouseEvent("click",{bubbles:true,detail:2}));e.dispatchEvent(new MouseEvent("dblclick",{bubbles:true,detail:2}));})()')
            n.wait('document.activeElement.matches("textarea.preview-text-editor")')
            assert n.js('externalOpens.length') == 0
            assert n.selected() == ['000.txt']
            n.screenshot(mode + '-editor-focus.png')
            # Repeat with the same editor already mounted.
            n.js('document.querySelector(' + selector + ').dispatchEvent(new MouseEvent("dblclick",{bubbles:true,detail:2}))')
            n.wait('document.activeElement.matches("textarea.preview-text-editor")')
            n.js('document.querySelector(`button[aria-label="Collapse preview panel"]`).click()')
    check('double-click opens collapsed preview and focuses TXT editor in both views', focus_preview)
    def borders():
        n.js('document.querySelector(`button[aria-label="Expand preview panel"]`)?.click()')
        n.wait('document.querySelector("textarea.preview-text-editor")!==null')
        n.js('document.querySelector("textarea.preview-text-editor").focus()')
        # WebKit suppresses :focus-within for an unfocused native window. Emulate
        # the CSS state while independently checking the real DOM focus target.
        n.js("window.focusRules=[];for(const sheet of document.styleSheets){for(const rule of sheet.cssRules){if(rule.selectorText && ['.preview-editor-layout:focus-within','.file-list-wrapper:focus-within'].some(selector=>rule.selectorText.startsWith(selector))){focusRules.push([rule,rule.selectorText]);rule.selectorText=rule.selectorText.replace(':focus-within','.native-test-focus')}}}")
        try:
            assert n.js('document.activeElement.matches("textarea.preview-text-editor")')
            n.js('document.querySelector(".preview-editor-layout").classList.add("native-test-focus")')
            editor = n.js('getComputedStyle(document.querySelector(".preview-editor-layout"),"::after").border')
            assert '2px' in editor and 'solid' in editor, editor
            assert n.js('getComputedStyle(document.querySelector(".file-list-wrapper"),"::after").borderStyle') == 'none'
            n.screenshot('editor-focus-border.png')
            n.js('document.querySelector(".preview-editor-layout").classList.remove("native-test-focus");document.querySelector(".file-list-container").focus();document.querySelector(".file-list-wrapper").classList.add("native-test-focus")')
            assert n.js('document.activeElement.matches(".file-list-container")')
            assert n.js('getComputedStyle(document.querySelector(".file-list-wrapper"),"::after").border') == editor
            assert n.js('getComputedStyle(document.querySelector(".preview-editor-layout"),"::after").borderStyle') == 'none'
            n.screenshot('item-pane-focus.png')
        finally:
            n.js('for(const [rule,selector] of focusRules)rule.selectorText=selector;document.querySelectorAll(".native-test-focus").forEach(e=>e.classList.remove("native-test-focus"))')
    check('matching section borders render for editor and file pane (CSS focus emulated)', borders)
    def tabs():
        n.js('document.querySelector(".file-list-container").focus()')
        key(n, 't', ctrlKey=True)
        n.wait('document.querySelectorAll(".tab-list > .tab").length===2')
        n.js('document.querySelector("textarea.preview-text-editor").focus()')
        key(n, '1', code='Digit1', ctrlKey=True)
        n.wait('document.querySelector(".tab-list > .tab").classList.contains("active")')
        key(n, '2', code='Digit2', ctrlKey=True)
        n.wait('document.querySelectorAll(".tab-list > .tab")[1].classList.contains("active")')
        before = n.js('JSON.parse(localStorage.fileExplorerSession).activeTabId')
        key(n, '9', code='Digit9', ctrlKey=True)
        assert n.js('JSON.parse(localStorage.fileExplorerSession).activeTabId') == before
        key(n, '1', code='Digit1', ctrlKey=True, shiftKey=True)
        assert n.js('JSON.parse(localStorage.fileExplorerSession).activeTabId') == before
    check('Ctrl+number selects matching tab from editor and ignores missing/modified numbers', tabs)
    def sidebar():
        favorites = [{'name': 'First', 'icon': 'folder', 'path': str(fixture / 'files')}, {'name': 'Second', 'icon': 'folder', 'path': str(fixture / 'other')}]
        n.js('localStorage.setItem("fileExplorerFavorites",' + json.dumps(json.dumps(favorites)) + ');window.dispatchEvent(new CustomEvent("favorites-updated"))')
        n.js('document.querySelector(`button[aria-label="Expand Favorites"]`)?.click()')
        n.wait('document.querySelectorAll(`.sidebar-section[aria-label="Favorites"] .sidebar-item`).length===2')
        n.js('document.querySelector(`button[aria-label="Expand Drives"]`)?.click()')
        n.wait('document.querySelectorAll(`.sidebar-section[aria-label="Favorites"] .sidebar-item`).length===2')
        n.wait('document.querySelectorAll(`.sidebar-item[aria-keyshortcuts^="Alt+"]`).length>=3')
        assert n.js('Array.from(document.querySelectorAll(".sidebar-item"),e=>e.getAttribute("aria-keyshortcuts")).filter(Boolean).slice(0,3)') == ['Alt+1','Alt+2','Alt+3']
        assert n.js('document.querySelector(".sidebar-item-shortcut").textContent') == 'Alt+1'
        # Emulate hover without moving the user's pointer.
        n.js("window.hoverRules=[];for(const sheet of document.styleSheets){for(const rule of sheet.cssRules){if(rule.selectorText?.includes('.sidebar-item:hover')){hoverRules.push([rule,rule.selectorText]);rule.selectorText=rule.selectorText.replaceAll('.sidebar-item:hover','.sidebar-item.native-test-hover')}}}")
        try:
            assert n.js('getComputedStyle(document.querySelector(".sidebar-item-shortcut")).visibility') == 'visible'
            assert n.js('getComputedStyle(document.querySelector(".sidebar-item-actions")).opacity') == '0'
            n.screenshot('sidebar-shortcuts.png')
            before = n.js('document.querySelector(".sidebar-item-trailing").getBoundingClientRect().width')
            n.js('document.querySelector(".sidebar-item").classList.add("native-test-hover")')
            n.wait('getComputedStyle(document.querySelector(".sidebar-item-actions")).opacity==="1"')
            assert n.js('getComputedStyle(document.querySelector(".sidebar-item-shortcut")).visibility') == 'hidden'
            assert n.js('document.querySelector(".sidebar-item-trailing").getBoundingClientRect().width') == before
            n.screenshot('sidebar-remove-on-hover.png')
        finally:
            n.js('for(const [rule,selector] of hoverRules)rule.selectorText=selector;document.querySelectorAll(".native-test-hover").forEach(e=>e.classList.remove("native-test-hover"))')
        n.js('document.querySelector("textarea.preview-text-editor")?.focus()')
        key(n, '2', code='Digit2', altKey=True)
        n.wait('JSON.parse(localStorage.fileExplorerSession).tabs.find(t=>t.id===JSON.parse(localStorage.fileExplorerSession).activeTabId).path===' + json.dumps(str(fixture / 'other')))
        n.js('document.querySelector(`button[aria-label="Collapse Favorites"]`).click()')
        n.wait('document.querySelector(".sidebar-item[aria-keyshortcuts]")?.getAttribute("aria-keyshortcuts")==="Alt+1"')
    check('Alt+number navigates and renumbers; hover swaps badge for action without resizing (CSS hover emulated)', sidebar)
    clients = json.loads(subprocess.check_output(['hyprctl', '-j', 'clients']))
    assert all(c['workspace']['id'] != json.loads(subprocess.check_output(['hyprctl', '-j', 'activeworkspace']))['id'] for c in clients if Path(f'/proc/{c["pid"]}/cwd').resolve() == fixture / 'cwd')
    n.ws.close()
finally:
    stop()
    (evidence / ('native-results-' + os.environ.get('EXPLR_CHECK_PHASE', 'green') + '.json')).write_text(json.dumps(results, indent=2) + '\n')
    import shutil
    shutil.copyfile(fixture / 'native.log', evidence / 'native.log')
    shutil.rmtree(fixture)
for result in results:
    print(('PASS: ' if result['passed'] else 'FAIL: ') + result['check'] + (': ' + result['error'] if 'error' in result else ''))
raise SystemExit(0 if all(result['passed'] for result in results) else 1)
