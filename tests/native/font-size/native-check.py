"""Check pixel font selection, legacy migration and restart persistence in native Tauri."""
from pathlib import Path
ROOT = Path.cwd()
source = (ROOT / 'tests/native/video-startup/native-check.py').read_text().split('\ntry:\n    (fixture')[0]
source = source.replace("ROOT / '.tmp/video-startup'", "ROOT / '.tmp/font-size'")
source = source.replace("ROOT / 'artifacts/video-startup'", "ROOT / 'artifacts/font-size'")
source = source.replace("EVIDENCE=ROOT/'artifacts/video-startup'", "EVIDENCE=ROOT/'artifacts/font-size'")
source = source.replace('(profile / name).mkdir(parents=True)', '(profile / name).mkdir(parents=True, exist_ok=True)')
exec(source)


def size(n):
    return n.js('parseFloat(getComputedStyle(document.querySelector(".file-item .file-name")).fontSize)')


def open_settings(n):
    n.key(',', ctrlKey=True)
    wait(n, '!!document.querySelector(`select[aria-label="Font size (px)"]`)')


try:
    (fixture / 'cwd').mkdir(parents=True)
    (fixture / 'files/Folder').mkdir(parents=True)
    (fixture / 'files/example.txt').write_text('Pixel font setting test\n')
    for mode in modes:
        settings_path = fixture / mode / 'config/com.explr.app/settings.json'
        settings_path.parent.mkdir(parents=True)
        settings_path.write_text(json.dumps({'font_size': 'Small', 'active_theme_id': 'system', 'sentinel': {'keep': [1, 2]}}))
        n = launch(mode)
        wait(n, 'getComputedStyle(document.documentElement).getPropertyValue("--item-font-size").trim()==="10px"')
        settings = json.loads(settings_path.read_text())
        assert settings['font_size'] == 10 and settings['sentinel'] == {'keep': [1, 2]}, settings
        for pixels in [8, 13, 32]:
            open_settings(n)
            options = n.js('Array.from(document.querySelector(`select[aria-label="Font size (px)"]`).options,e=>e.textContent)')
            assert options == [str(value) + ' px' for value in range(8, 33)], options
            n.js('(()=>{const e=document.querySelector(`select[aria-label="Font size (px)"]`);e.value=' + json.dumps(str(pixels)) + ';e.dispatchEvent(new Event("change",{bubbles:true}))})()')
            wait(n, 'getComputedStyle(document.documentElement).getPropertyValue("--item-font-size").trim()===' + json.dumps(str(pixels) + 'px'))
            if pixels == 13:
                n.js('document.querySelector(`select[aria-label="Font size (px)"]`).scrollIntoView({block:"center"})')
                n.screenshot(mode + '-pixel-selector.png')
            n.key('Escape')
            wait(n, '!document.querySelector("[role=dialog], .modal-overlay")')
            for view, label in [('grid', 'Icons view'), ('list', 'List view')]:
                n.js('document.querySelector(' + json.dumps('button[aria-label="' + label + '"]') + ').click()')
                wait(n, '!!document.querySelector(".file-item.view-mode-' + view + '")')
                actual = size(n)
                assert abs(actual - pixels) < .02, {'view': mode, 'layout': view, 'selected': pixels, 'actual': actual}
                bounds = n.js('(()=>{const e=document.querySelector(".file-item .file-name"),r=e.getBoundingClientRect(),p=e.closest(".file-item").getBoundingClientRect();return {top:r.top,bottom:r.bottom,parentTop:p.top,parentBottom:p.bottom}})()')
                assert bounds['top'] >= bounds['parentTop'] - 1 and bounds['bottom'] <= bounds['parentBottom'] + 1, bounds
                results.append({'view': mode, 'layout': view, 'selected': pixels, 'computedPixels': actual, 'passed': True})
            settings = json.loads(settings_path.read_text())
            assert settings['font_size'] == pixels and settings['sentinel'] == {'keep': [1, 2]}, settings
        n.screenshot(mode + '-32px-list.png')
        n.ws.close()
        stop()
        n = launch(mode)
        wait(n, 'getComputedStyle(document.documentElement).getPropertyValue("--item-font-size").trim()==="32px"')
        assert abs(size(n) - 32) < .02
        n.ws.close()
        stop()
        print(mode + ': Small migrated to 10px; 8/13/32px match both item views, fit their rows and survive restart', flush=True)
finally:
    stop()
    (evidence / 'native-results.json').write_text(json.dumps({'results': results, 'workspaceBefore': workspace_before,
        'workspaceAfter': json.loads(subprocess.check_output(['hyprctl', '-j', 'activeworkspace']))['id']}, indent=2) + '\n')
    for log in fixture.glob('*/native.log'):
        shutil.copyfile(log, evidence / (log.parent.name + '-native.log'))
    shutil.rmtree(fixture)
