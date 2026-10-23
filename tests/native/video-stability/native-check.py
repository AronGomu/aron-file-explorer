"""Check preview startup stays hidden until ready, then remains stable in native Tauri."""
from pathlib import Path

ROOT = Path.cwd()
# Reuse the isolated native launch/cleanup and WebKit inspector helpers.
source = (ROOT / 'tests/native/video-startup/native-check.py').read_text()
source = source.split('\ntry:\n    (fixture')[0]
source = source.replace("ROOT / '.tmp/video-startup'", "ROOT / '.tmp/video-stability'")
source = source.replace("ROOT / 'artifacts/video-startup'", "ROOT / 'artifacts/video-stability'")
source = source.replace("EVIDENCE=ROOT/'artifacts/video-startup'", "EVIDENCE=ROOT/'artifacts/video-stability'")
exec(source)

try:
    (fixture / 'cwd').mkdir(parents=True)
    (fixture / 'files/Folder').mkdir(parents=True)
    for name, codec, audio in [('direct.webm', 'libvpx', 'libvorbis'), ('fallback.mkv', 'libx264', 'aac')]:
        subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
                        '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=24:d=12',
                        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
                        '-c:v', codec, '-threads', '2', '-c:a', audio, '-shortest',
                        '-y', str(fixture / 'files' / name)], check=True)
    for mode in modes:
        n = launch(mode)
        for name in ['direct.webm', 'fallback.mkv']:
            n.js('''window.previewSamples=[];window.previewSampling=true;
                (function sample(){
                    const v=document.querySelector('.preview-media video');
                    if(v){const style=getComputedStyle(v),rect=v.getBoundingClientRect();
                        window.previewSamples.push({visible:style.visibility==='visible'&&Number(style.opacity)>0,
                            ready:v.readyState,error:!!v.error,width:rect.width,height:rect.height,
                            busy:v.parentElement.getAttribute('aria-busy')});}
                    if(window.previewSampling)requestAnimationFrame(sample);
                })()''')
            select(n, fixture / 'files' / name)
            wait(n, '''(()=>{const v=document.querySelector('video');return v?.readyState>=2&&v.videoWidth>0&&
                getComputedStyle(v).visibility==='visible'&&v.parentElement.getAttribute('aria-busy')!=='true'})()''', 10)
            time.sleep(1)
            n.js('window.previewSampling=false')
            samples = n.js('window.previewSamples')
            (evidence / (os.environ.get('EXPLR_CHECK_PHASE', 'green') + '-' + mode + '-' + name + '.json')).write_text(json.dumps(samples, indent=2) + '\n')
            assert samples, 'No preview frames sampled'
            first_visible = next(i for i, sample in enumerate(samples) if sample['visible'])
            assert all(sample['ready'] >= 2 and not sample['error'] for sample in samples if sample['visible']), 'Player exposed before decoding a frame'
            assert all(sample['visible'] for sample in samples[first_visible:]), samples
            assert len({(sample['width'], sample['height']) for sample in samples}) == 1, samples
            assert n.js('document.querySelector("video").paused'), 'Preview must not autoplay'
            n.js('document.querySelector("video").muted=true;document.querySelector("video").play()')
            wait(n, 'document.querySelector("video").currentTime>.2')
            n.js('document.querySelector("video").currentTime=7')
            wait(n, '(()=>{const v=document.querySelector("video");return !v.seeking&&v.currentTime>7.2})()')
            n.screenshot(mode + '-' + name + '.png')
            results.append({'view': mode, 'file': name, 'passed': True, 'samples': samples})
            print(mode + '/' + name + ': stable reveal, no autoplay, playback and seek passed', flush=True)
            select(n, fixture / 'files/Folder')
            wait(n, 'document.querySelector("video")===null')
        n.ws.close()
        stop()
finally:
    stop()
    (evidence / ('native-results-' + os.environ.get('EXPLR_CHECK_PHASE', 'green') + '.json')).write_text(json.dumps({
        'workspaceBefore': workspace_before,
        'workspaceAfter': json.loads(subprocess.check_output(['hyprctl', '-j', 'activeworkspace']))['id'],
        'results': results}, indent=2) + '\n')
    shutil.rmtree(fixture)
print('PASS: native previews reveal once ready, keep constant geometry, play and seek in both views.')
