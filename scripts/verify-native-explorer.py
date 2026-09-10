#!/usr/bin/env python3
"""Verify retained T4 native pixels/process/package evidence; never launch app."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile

repo = Path(__file__).resolve().parents[1]
capture = Path(sys.argv[1]).resolve()
assert capture.parent == repo / 'artifacts/theme-validation/native'
package = repo / 'artifacts/theme-validation/t4-integration/Explr_0.2.3_amd64.deb'
extracted = repo / '.tmp/theme-validation/t4-integration-package-root/usr/bin/src-tauri'
unbundled = repo / 'target/debug/src-tauri'


def digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def pixels(name, arguments):
    return subprocess.check_output(['magick', str(capture / f'{name}.png'), *arguments])


process = subprocess.Popen(['dpkg-deb', '--fsys-tarfile', str(package)], stdout=subprocess.PIPE)
archive_binary = None
with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
    for member in archive:
        if member.name.lstrip('./') == 'usr/bin/src-tauri':
            archive_binary = hashlib.file_digest(archive.extractfile(member), 'sha256').hexdigest()
assert process.wait() == 0
assert archive_binary == digest(extracted)
assert (capture / 'running-executable.sha256').read_text().split()[0] == archive_binary

# Tauri CLI 2.11.4 restores UNK after packaging; exactly three marker bytes differ.
differences = []
with unbundled.open('rb') as original, extracted.open('rb') as bundled:
    offset = 0
    while True:
        a, b = original.read(1024 * 1024), bundled.read(1024 * 1024)
        assert len(a) == len(b)
        if not a:
            break
        if a != b:
            differences.extend(offset + i for i, (x, y) in enumerate(zip(a, b)) if x != y)
        offset += len(a)
assert len(differences) == 3
marker_offset = differences[0] - len(b'__TAURI_BUNDLE_TYPE_VAR_')
with unbundled.open('rb') as original, extracted.open('rb') as bundled:
    original.seek(marker_offset)
    bundled.seek(marker_offset)
    assert original.read(len(b'__TAURI_BUNDLE_TYPE_VAR_UNK')) == b'__TAURI_BUNDLE_TYPE_VAR_UNK'
    assert bundled.read(len(b'__TAURI_BUNDLE_TYPE_VAR_DEB')) == b'__TAURI_BUNDLE_TYPE_VAR_DEB'

assert (capture / 'sandbox.status').read_text().strip() == '0'
assert (capture / 'source-config.before').read_bytes() == (capture / 'source-config.after').read_bytes()
assert 'host-home=absent' in (capture / 'namespace-postconditions.txt').read_text()
assert 'private-X-socket=verified' in (capture / 'namespace-postconditions.txt').read_text()
removed = (capture / 'cleanup.txt').read_text().strip().removeprefix('removed=')
assert not Path(removed).exists()

states = ['state-before', 'state-after-catppuccin-latte', 'state-after-catppuccin-mocha']
scroll_top_text = (capture / 'scroll-before.ocr.txt').read_text()
assert 'Projects' in scroll_top_text
assert 'sample-003' not in scroll_top_text
readings = []
for state in states:
    text = (capture / f'{state}.ocr.txt').read_text()
    assert 't4-draft-kept' in text
    assert 'sample-003' in text
    assert re.search(r'sample-004[ .]txt', text)
    for field in ['pid', 'starttime', 'cwd']:
        assert (capture / f'{state}.pty-{field}').read_bytes() == (capture / f'state-before.pty-{field}').read_bytes()
    settings = json.loads((capture / f'{state}.settings.json').read_text())
    theme = settings['active_theme_id']
    tokens = json.loads((repo / f'src-tauri/resources/themes/{theme}.theme.json').read_text())['tokens']
    selected = pixels(state, ['-format', '%[hex:p{900,240}]', 'info:']).decode().lower()
    background = pixels(state, ['-format', '%[hex:p{900,180}]', 'info:']).decode().lower()
    assert selected == tokens['accentSurface'][1:].lower()
    assert background == tokens['background'][1:].lower()
    # Exclude blinking caret; OCR separately checks complete unsubmitted draft.
    draft = pixels(state, ['-crop', '168x24+260+594', '+repage', 'RGB:-'])
    assert draft == pixels('state-before', ['-crop', '168x24+260+594', '+repage', 'RGB:-'])
    readings.append({'state': state, 'theme': theme, 'selection': 'sample-004.txt', 'firstVisible': 'sample-003.txt', 'selectedPixel': selected, 'backgroundPixel': background, 'draftPixelsSha256': hashlib.sha256(draft).hexdigest()})

# Fixed-coordinate native fixture: require actual selected fill and primary ink,
# not merely a screenshot filename claiming selection. Browser covers computed AA.
metadata = []
for theme in ['catppuccin-latte', 'catppuccin-mocha']:
    tokens = json.loads((repo / f'src-tauri/resources/themes/{theme}.theme.json').read_text())['tokens']
    primary = bytes.fromhex(tokens['textPrimary'][1:])
    for state, point, crop in [
        ('active-sidebar-capacity', '230,360', '190x17+45+350'),
        ('grid-selected-cut', '540,250', '115x24+430+220'),
        ('list', '900,240', '190x17+312+231'),
        ('details', '1100,280', '100x24+780+255'),
        ('details', '1100,280', '120x24+890+255'),
        ('details', '1100,280', '120x24+1010+255'),
    ]:
        name = f'{theme}-{state}'
        fill = pixels(name, ['-format', f'%[hex:p{{{point}}}]', 'info:']).decode().lower()
        assert fill == tokens['accentSurface'][1:].lower(), (name, 'not selected/active', fill)
        ink = pixels(name, ['-crop', crop, '+repage', '-depth', '8', 'RGB:-'])
        primary_count = sum(ink[i:i + 3] == primary for i in range(0, len(ink), 3))
        # Small antialiased glyphs need not contain five fully covered pixels.
        # Exact primary ink must still occur inside each isolated metadata crop.
        assert primary_count > 0, (name, crop, 'missing primary text pixels', primary_count)
        metadata.append({'theme': theme, 'state': state, 'crop': crop, 'selectedPixel': fill, 'primary': tokens['textPrimary'], 'primaryPixelCount': primary_count})

report = {
    'archiveSha256': digest(package), 'archiveExtractedRunningBinarySha256': archive_binary,
    'unbundledSha256': digest(unbundled), 'markerDifferenceOffsets': differences,
    'nativeKind': 'extracted debug .deb inside fixture-only bwrap/Xvfb; not OS-installed',
    'ptyPid': (capture / 'state-before.pty-pid').read_text().strip(),
    'ptyStarttime': (capture / 'state-before.pty-starttime').read_text().strip(),
    'ptyCwd': (capture / 'state-before.pty-cwd').read_text().strip(),
    'readings': readings,
    'metadataReadings': metadata,
    'gaps': ['ThisPC native UI unreachable through reliable existing navigation', 'Tab/menu/ThisPC item keyboard focus absent from existing mouse-only contracts', 'Pointer tab drag remains baseline failure; native pointer-drag success not claimed'],
}
(capture / 'verified-explorer.json').write_text(json.dumps(report, indent=2) + '\n')
print('Native package identity, marker-only delta, selected file, nonzero scroll, PTY draft/PID/starttime/cwd, isolation cleanup: verified')
