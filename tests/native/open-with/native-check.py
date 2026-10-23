"""Verify matching program submenus and actual GIO launches using isolated desktop entries."""
from pathlib import Path

ROOT = Path.cwd()
source = (ROOT / 'tests/native/video-startup/native-check.py').read_text().split('\ntry:\n    (fixture')[0]
source = source.replace("ROOT / '.tmp/video-startup'", "ROOT / '.tmp/open-with'")
source = source.replace("ROOT / 'artifacts/video-startup'", "ROOT / 'artifacts/open-with'")
source = source.replace("EVIDENCE=ROOT/'artifacts/video-startup'", "EVIDENCE=ROOT/'artifacts/open-with'")
source = source.replace('(profile / name).mkdir(parents=True)', '(profile / name).mkdir(parents=True, exist_ok=True)')
exec(source)
import base64, hashlib, sys, zipfile

files = [('quote # \' $ name.txt', 'text/plain', 'text'), ('picture.png', 'image/png', 'image'),
         ('movie.mp4', 'video/mp4', 'video'), ('document.pdf', 'application/pdf', 'pdf'),
         ('archive.zip', 'application/zip', 'archive'), ('unknown.blob', 'application/octet-stream', 'binary')]


def menu(n, name):
    selector = json.dumps(f'.file-item[data-path="{fixture / "files" / name}"]')
    n.js('document.querySelector(' + selector + ').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:innerWidth-12,clientY:innerHeight-12}))')
    wait(n, '!!document.querySelector(".context-menu")')
    n.js('document.querySelector(".context-menu > .context-menu-list > .context-menu-item").click()')
    wait(n, '!!document.querySelector(".context-submenu")&&!document.querySelector(".context-submenu").textContent.includes("Loading applications")')
    return n.js('Array.from(document.querySelectorAll(".context-submenu > ul > li > .context-menu-label"),e=>e.textContent)')


def invoke(n, command, arguments):
    n.js('window.openWithResult=null;window.__TAURI_INTERNALS__.invoke(' + json.dumps(command) + ',' + json.dumps(arguments) + ').then(value=>window.openWithResult={ok:true,value}).catch(error=>window.openWithResult={ok:false,error:String(error)})')
    wait(n, 'window.openWithResult!==null')
    return n.js('window.openWithResult')


try:
    (fixture / 'cwd').mkdir(parents=True)
    (fixture / 'files/Folder').mkdir(parents=True)
    (fixture / 'files' / files[0][0]).write_text('Native application selection fixture\n')
    (fixture / 'files/picture.png').write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII='))
    subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
                    'testsrc2=s=128x96:r=12:d=1', '-c:v', 'libx264', '-threads', '1', '-y', str(fixture / 'files/movie.mp4')], check=True)
    (fixture / 'files/document.pdf').write_bytes(b'%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n')
    with zipfile.ZipFile(fixture / 'files/archive.zip', 'w') as archive:
        archive.writestr('notes.txt', 'Archive fixture\n')
    (fixture / 'files/unknown.blob').write_bytes(bytes(range(256)))
    hashes = {name: hashlib.sha256((fixture / 'files' / name).read_bytes()).hexdigest() for name, _, _ in files}
    recorder = fixture / 'record.py'
    recorder.write_text('import json,sys\nwith open(sys.argv[1],"a") as output:\n output.write(json.dumps({"application":sys.argv[2],"paths":sys.argv[3:]})+"\\n")\n')
    for mode in modes:
        profile = fixture / mode
        applications = profile / 'data/applications'
        applications.mkdir(parents=True)
        (profile / 'config').mkdir()
        receipt = profile / 'launches.jsonl'
        mime_types = ';'.join(mime for _, mime, _ in files) + ';'
        entries = [('alternate', 'Alternate Viewer', mime_types)]
        entries += [(kind, 'Zulu ' + kind.title() + ' Viewer', mime + ';') for _, mime, kind in files]
        entries += [('long-' + str(i), 'Text Program ' + str(i), 'text/plain;') for i in range(40)]
        for app_id, name, mime in entries:
            command = ' '.join('"' + str(argument).replace('\\', '\\\\').replace('"', '\\"') + '"' for argument in [sys.executable, recorder, receipt, app_id]) + ' %f'
            (applications / ('explr-test-' + app_id + '.desktop')).write_text('[Desktop Entry]\nType=Application\nName=' + name + '\nExec=' + command + '\nMimeType=' + mime + '\nTerminal=false\n')
        (profile / 'config/mimeapps.list').write_text('[Default Applications]\n' + ''.join(mime + '=explr-test-' + kind + '.desktop;\n' for _, mime, kind in files))
        subprocess.run(['update-desktop-database', str(applications)], check=True)
        n = launch(mode)
        for name, mime, kind in files:
            labels = menu(n, name)
            assert labels[0] == 'Zulu ' + kind.title() + ' Viewer (default)', labels
            assert 'Alternate Viewer' in labels, labels
            for _, _, other in files:
                if other != kind:
                    assert 'Zulu ' + other.title() + ' Viewer' not in labels, labels
            bounds = n.js('(()=>{const e=document.querySelector(".context-submenu"),r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,scroll:e.scrollHeight,client:e.clientHeight}})()')
            assert bounds['x'] >= 0 and bounds['y'] >= 0 and bounds['right'] <= bounds['width'] and bounds['bottom'] <= bounds['height'], bounds
            if kind == 'text':
                assert bounds['scroll'] > bounds['client'], bounds
                time.sleep(.2)
                n.screenshot(mode + '-applications.png')
            n.js('Array.from(document.querySelectorAll(".context-submenu .context-menu-item")).find(e=>e.querySelector(".context-menu-label")?.textContent==="Alternate Viewer").click()')
            wait(n, 'document.querySelector(".context-menu")===null')
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                launches = [json.loads(line) for line in receipt.read_text().splitlines()] if receipt.exists() else []
                if len(launches) >= len(results) % len(files) + 1:
                    break
                time.sleep(.05)
            assert launches[-1] == {'application': 'alternate', 'paths': [str(fixture / 'files' / name)]}, launches
            results.append({'view': mode, 'file': name, 'mime': mime, 'passed': True, 'programCount': len(labels), 'bounds': bounds})
        time.sleep(.1)
        assert len(receipt.read_text().splitlines()) == len(files), 'Unexpected duplicate/default launch'
        rejected = invoke(n, 'open_file_with_application', {'path': str(fixture / 'files/picture.png'), 'applicationId': 'explr-test-text.desktop'})
        assert not rejected['ok'], rejected
        rejected = invoke(n, 'open_file_with_application', {'path': str(fixture / 'files/Folder'), 'applicationId': 'explr-test-text.desktop'})
        assert not rejected['ok'], rejected
        n.ws.close()
        stop()
        print(mode + ': six MIME types, matching/default programs, safe chosen-program launches, long-list positioning and invalid-launch rejection passed', flush=True)
    assert all(hashlib.sha256((fixture / 'files' / name).read_bytes()).hexdigest() == value for name, value in hashes.items())
finally:
    stop()
    (evidence / ('native-results-' + os.environ.get('EXPLR_CHECK_PHASE', 'green') + '.json')).write_text(json.dumps({
        'results': results, 'workspaceBefore': workspace_before,
        'workspaceAfter': json.loads(subprocess.check_output(['hyprctl', '-j', 'activeworkspace']))['id']}, indent=2) + '\n')
    for log in fixture.glob('*/native.log'):
        shutil.copyfile(log, evidence / (log.parent.name + '-native.log'))
    shutil.rmtree(fixture)
