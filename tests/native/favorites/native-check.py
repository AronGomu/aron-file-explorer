"""Native checks for confirmed favorite removal and the dedicated folder drop area."""
from pathlib import Path
import json, os, shlex, shutil, signal, subprocess, time, urllib.request, uuid

ROOT = Path.cwd()
fixture = ROOT / '.tmp/favorites' / uuid.uuid4().hex[:8]
evidence = ROOT / 'artifacts/favorites'
binary = Path(os.environ.get('EXPLR_TEST_BINARY', ROOT / 'target/debug/src-tauri'))
source = (ROOT / 'tests/native/selection-deletion/native-check.py').read_text().split("if __name__=='__main__':")[0].replace('9234', '9235').replace("EVIDENCE=ROOT/'artifacts/selection-deletion'", "EVIDENCE=ROOT/'artifacts/favorites'")
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
    for name in ['data', 'config', 'cache', 'state']:
        (profile / name).mkdir(parents=True)
    env = ['env', 'GDK_BACKEND=wayland', 'GDK_SCALE=1', 'LIBGL_ALWAYS_SOFTWARE=1', 'WEBKIT_DISABLE_COMPOSITING_MODE=1', 'WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9235']
    env += [f'XDG_{key}_HOME={profile / value}' for key, value in [('DATA', 'data'), ('CONFIG', 'config'), ('CACHE', 'cache'), ('STATE', 'state')]]
    arguments = [str(fixture / 'files')]
    if mode == 'chooser':
        request = dict(mode='OpenFile', title='Favorites test', appId='native.test', parentWindow='', modal=True,
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
    n.js('document.querySelector(`button[aria-label="Expand Favorites"]`)?.click()')
    time.sleep(.15)
    clients = json.loads(subprocess.check_output(['hyprctl', '-j', 'clients']))
    own_clients = [client for client in clients if Path(f'/proc/{client["pid"]}/cwd').resolve() == fixture / 'cwd']
    assert own_clients and all(client['workspace']['id'] == workspace for client in own_clients)
    assert json.loads(subprocess.check_output(['hyprctl', '-j', 'activeworkspace']))['id'] != workspace
    return n


def begin(n, name):
    selector = json.dumps(f'.file-item[data-path="{fixture / "files" / name}"]')
    n.js('window.__source=document.querySelector(' + selector + ');window.__drag=new DataTransfer();window.__source.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:window.__drag}))')
    time.sleep(.15)


def drag(n, selector, kind='dragover', related=None):
    return n.js('(()=>{const event=new DragEvent(' + json.dumps(kind) + ',{bubbles:true,cancelable:true,dataTransfer:window.__drag,relatedTarget:' + ('document.querySelector(' + json.dumps(related) + ')' if related else 'null') + '});document.querySelector(' + json.dumps(selector) + ').dispatchEvent(event);return event.defaultPrevented})()')


def end(n):
    n.js('window.__source.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:window.__drag}))')
    time.sleep(.15)


def favorites(n, mode):
    return n.js('JSON.parse(localStorage.getItem(' + json.dumps('chooserFavorites' if mode == 'chooser' else 'fileExplorerFavorites') + ')||"[]")')


try:
    (fixture / 'cwd').mkdir(parents=True)
    (fixture / 'files/Folder').mkdir(parents=True)
    (fixture / 'files/notes.txt').write_text('Keep this file.\n')
    section = 'section[aria-label="Favorites"]'
    header = section + ' .sidebar-section-header'
    for mode in modes:
        n = launch(mode)
        begin(n, 'Folder')
        n.wait('document.querySelector(".favorites-drop-hint")!==null')
        assert not drag(n, header), 'Favorites header must not accept folder drops'
        assert not drag(n, section), 'Favorites section background must not accept folder drops'
        assert not drag(n, header, 'drop')
        assert favorites(n, mode) == []
        assert drag(n, '.favorites-drop-hint')
        n.wait('document.querySelector(`.favorites-drop-hint[data-favorites-drop-active="true"]`)!==null')
        assert n.js('document.querySelectorAll(`[data-favorites-drop-active="true"]`).length') == 1
        assert n.js('getComputedStyle(document.querySelector(".favorites-drop-hint")).outlineStyle') == 'solid'
        n.screenshot(mode + '-drop-area.png')
        drag(n, '.favorites-drop-hint', 'dragleave', header)
        drag(n, header)
        n.wait('document.querySelector(`[data-favorites-drop-active="true"]`)===null')
        assert drag(n, '.favorites-drop-hint', 'drop')
        end(n)
        assert len(favorites(n, mode)) == 1
        assert favorites(n, mode)[0]['path'] == str(fixture / 'files/Folder')
        assert (fixture / 'files/Folder').is_dir(), 'Adding a favorite must not move the folder'
        begin(n, 'notes.txt')
        assert n.js('document.querySelector(".favorites-drop-hint")===null'), 'File-only drag must not offer folder favorites'
        end(n)
        begin(n, 'Folder')
        n.js('document.querySelector(`button[aria-label="Collapse sidebar"]`).click()')
        assert not drag(n, 'button[aria-label="Open Favorites"]'), 'Collapsed shortcut must not accept favorite drops'
        assert not drag(n, 'button[aria-label="Open Favorites"]', 'drop')
        assert len(favorites(n, mode)) == 1
        n.js('document.querySelector(`button[aria-label="Expand sidebar"]`).click()')
        end(n)
        if mode == 'explorer':
            remove = 'document.querySelector(`button[aria-label="Remove from favorites"]`).click()'
        else:
            n.js('document.querySelector(`button[aria-label="Favorite current folder"]`).click()')
            remove = 'document.querySelector(`button[aria-label="Remove current folder from favorites"]`).click()'
        before = favorites(n, mode)
        n.js(remove)
        n.wait('document.querySelector(`[role=dialog][aria-label="Remove favorite"]`)!==null')
        assert favorites(n, mode) == before
        n.js('document.querySelector("[role=dialog] button").click()')
        n.wait('document.querySelector("[role=dialog]")===null')
        assert favorites(n, mode) == before
        n.js(remove)
        n.wait('document.querySelector("[role=dialog]")!==null')
        n.screenshot(mode + '-remove-confirmation.png')
        n.js('document.querySelectorAll("[role=dialog] button")[1].click()')
        n.wait('document.querySelector("[role=dialog]")===null')
        assert len(favorites(n, mode)) == len(before) - 1
        assert (fixture / 'files/Folder').is_dir()
        results.append({'view': mode, 'passed': True, 'checks': ['header/background reject drops', 'only hint highlights', 'leaving hint clears highlight', 'hint drop adds folder without moving it', 'files rejected', 'collapsed shortcut rejects drops', 'removal cancellation preserves favorite', 'confirmation removes only shortcut']})
        n.ws.close()
        stop()
finally:
    stop()
    (evidence / ('native-results-' + os.environ.get('EXPLR_CHECK_PHASE', 'green') + '.json')).write_text(json.dumps({'fixture': str(fixture), 'workspaceBefore': workspace_before, 'workspaceAfter': json.loads(subprocess.check_output(['hyprctl', '-j', 'activeworkspace']))['id'], 'results': results}, indent=2) + '\n')
    for log in fixture.glob('*/native.log'):
        shutil.copyfile(log, evidence / (log.parent.name + '-native.log'))
    shutil.rmtree(fixture)
print('PASS: Both native sidebars confirm removal and accept folder favorites only in the highlighted hint area.')
