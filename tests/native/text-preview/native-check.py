"""Check TXT editing in both native views without moving the user's cursor."""
from pathlib import Path
import json, os, shlex, shutil, signal, subprocess, time, urllib.request, uuid

ROOT = Path.cwd()
fixture = ROOT / '.tmp/text-preview' / uuid.uuid4().hex[:8]
evidence = ROOT / 'artifacts/text-preview'
binary = Path(os.environ.get('EXPLR_TEST_BINARY', ROOT / 'target/release/src-tauri'))
source = (ROOT / 'tests/native/selection-deletion/native-check.py').read_text().split("if __name__=='__main__':")[0].replace('9234', '9235').replace("EVIDENCE=ROOT/'artifacts/selection-deletion'", "EVIDENCE=ROOT/'artifacts/text-preview'")
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
        request = dict(mode='OpenFile', title='Text preview test', appId='native.test', parentWindow='', modal=True,
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
    n.wait('document.querySelector(' + json.dumps(f'.file-item[data-path="{fixture / "files/alpha.txt"}"]') + ')!==null')
    if n.selected() != ['alpha.txt']:
        click_file(n, 'alpha.txt')
    n.js('document.querySelector(`button[aria-label="Expand preview panel"]`)?.click()')
    time.sleep(.3)
    (evidence / (mode + '-initial.txt')).write_text(n.js('document.body.innerText'))
    n.wait('document.querySelector("textarea.preview-text-editor")!==null')
    clients = json.loads(subprocess.check_output(['hyprctl', '-j', 'clients']))
    own_clients = [client for client in clients if Path(f'/proc/{client["pid"]}/cwd').resolve() == fixture / 'cwd']
    assert own_clients and all(client['workspace']['id'] == workspace for client in own_clients)
    assert json.loads(subprocess.check_output(['hyprctl', '-j', 'activeworkspace']))['id'] != workspace
    return n


def click_file(n, name):
    selector = json.dumps(f'.file-item[data-path="{fixture / "files" / name}"]')
    n.js('document.querySelector(' + selector + ').dispatchEvent(new MouseEvent("click",{bubbles:true,detail:1}))')
    time.sleep(.1)


def key(n, value, **modifiers):
    n.js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",' + json.dumps(dict(key=value, bubbles=True, cancelable=True, **modifiers)) + '))')


def edit(n, text):
    n.js('(()=>{const e=document.querySelector("textarea.preview-text-editor");e.click();e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,' + json.dumps(text) + ');e.dispatchEvent(new Event("input",{bubbles:true}));})()')
    n.wait('document.querySelector(".preview-text-actions").textContent.includes("Unsaved changes")')


try:
    (fixture / 'cwd').mkdir(parents=True)
    (fixture / 'files').mkdir()
    path = fixture / 'files/alpha.txt'
    (fixture / 'files/bravo.txt').write_bytes(b'x' * (256 * 1024 + 1))
    (fixture / 'files/charlie.json').write_text('{"readOnly":true}')
    for mode in modes:
        path.write_bytes(b'Original\r\nSecond line\r\n')
        n = launch(mode)
        edit(n, 'Edited in ' + mode + '\nSecond line\n')
        assert path.read_bytes() == b'Original\r\nSecond line\r\n'
        key(n, 's', ctrlKey=True)
        n.wait('document.querySelector(`[role=dialog][aria-label="Save text file"]`)!==null')
        key(n, 's', ctrlKey=True)
        assert n.js('document.querySelectorAll("[role=dialog]").length') == 1
        key(n, 'Escape')
        n.wait('document.querySelector("[role=dialog]")===null')
        assert path.read_bytes() == b'Original\r\nSecond line\r\n'
        key(n, 's', ctrlKey=True)
        n.wait('document.querySelector("[role=dialog]")!==null')
        n.screenshot(mode + '-save-confirmation.png')
        n.js('document.querySelectorAll("[role=dialog] button")[1].click()')
        n.wait('document.querySelector(".preview-text-actions").textContent.includes("Saved")')
        assert path.read_bytes() == ('Edited in ' + mode + '\r\nSecond line\r\n').encode()
        edit(n, 'Saved by icon\n')
        n.js('document.querySelector(`button[aria-label="Save text file"]`).click()')
        n.wait('document.querySelector("[role=dialog]")!==null')
        assert path.read_bytes() != b'Saved by icon\r\n'
        n.js('document.querySelectorAll("[role=dialog] button")[1].click()')
        n.wait('document.querySelector(".preview-text-actions").textContent.includes("Saved")')
        assert path.read_bytes() == b'Saved by icon\r\n'
        n.screenshot(mode + '-saved.png')
        edit(n, 'Local draft\n')
        path.write_text('External change\n')
        key(n, 's', ctrlKey=True)
        n.wait('document.querySelector("[role=dialog]")!==null')
        n.js('document.querySelectorAll("[role=dialog] button")[1].click()')
        n.wait('Array.from(document.querySelectorAll("[role=alert]")).some(e=>e.textContent.includes("changed"))')
        assert path.read_text() == 'External change\n'
        assert n.js('document.querySelector("textarea.preview-text-editor").value') == 'Local draft\n'
        click_file(n, 'bravo.txt')
        n.wait('document.querySelector(".preview-text")?.textContent.includes("256 KiB")')
        assert n.js('document.querySelector("textarea.preview-text-editor")===null')
        click_file(n, 'charlie.json')
        n.wait('document.querySelector(".preview-text code")!==null')
        assert n.js('document.querySelector("textarea.preview-text-editor")===null')
        results.append({'view': mode, 'passed': True, 'checks': ['draft does not autosave', 'Ctrl+S confirms', 'repeated shortcut has one dialog', 'Escape cancels without closing chooser', 'confirmed Ctrl+S writes CRLF', 'save icon confirms and writes', 'external changes reject save and keep draft', 'truncated TXT and JSON stay read-only']})
        n.ws.close()
        stop()
finally:
    stop()
    (evidence / ('native-results-' + os.environ.get('EXPLR_CHECK_PHASE', 'green') + '.json')).write_text(json.dumps({'fixture': str(fixture), 'workspaceBefore': workspace_before, 'workspaceAfter': json.loads(subprocess.check_output(['hyprctl', '-j', 'activeworkspace']))['id'], 'results': results}, indent=2) + '\n')
    for log in fixture.glob('*/native.log'):
        shutil.copyfile(log, evidence / (log.parent.name + '-native.log'))
    shutil.rmtree(fixture)
print('PASS: Explorer and Chooser TXT editing, confirmed saves, cancellation, CRLF and conflict protection.')
