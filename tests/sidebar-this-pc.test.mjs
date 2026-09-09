import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sidebarPath = new URL('../src/components/sidebar/Sidebar.jsx', import.meta.url);
const sidebar = fs.readFileSync(sidebarPath, 'utf8');

test('removes built-in This PC section', () => {
  assert.doesNotMatch(sidebar, /<h3 className="sidebar-section-title">This PC<\/h3>/);
  assert.doesNotMatch(sidebar, /name="This PC"/);
  assert.doesNotMatch(sidebar, /sectionCollapsed\.thisPC/);
  assert.doesNotMatch(sidebar, /thisPC: false/);
});

test('removes built-in user shortcuts', () => {
  for (const identifier of [
    'browseToProtectedFolder',
    'getUserDirectories',
    'userDirectories',
    'getUserVolume',
    'userVolume'
  ]) {
    assert.doesNotMatch(sidebar, new RegExp(`\\b${identifier}\\b`));
  }
});

test('retains sidebar shell and navigation', () => {
  assert.match(sidebar, /className="sidebar-content"/);
  assert.match(sidebar, /className="sidebar-footer"/);

  const headings = ['Favorites', 'Drives', 'Network'].map((heading) => {
    const title = `<h3 className="sidebar-section-title">${heading}</h3>`;
    assert.equal(sidebar.split(title).length - 1, 1);
    return { index: sidebar.indexOf(title) };
  });
  assert.ok(headings.every(({ index }) => index >= 0));
  assert.ok(headings[0].index < headings[1].index);
  assert.ok(headings[1].index < headings[2].index);
  assert.match(sidebar, /aria-label="Toggle Terminal"/);
  assert.match(sidebar, />Settings<\/span>/);
  assert.match(sidebar, />Templates<\/span>/);
  assert.match(sidebar, />Add Source<\/span>/);
  assert.match(sidebar, /aria-label="Add Datasource"/);
});

test('retains drive metadata and shared loading', () => {
  assert.match(sidebar, /get_meta_data_as_json/);
  assert.match(sidebar, /setSystemInfo/);
  assert.match(sidebar, /loadVolumes/);
  assert.match(sidebar, /systemInfo\?\.current_running_os\?\.toLowerCase\(\)/);
});

test('removes orphan permission helper only', () => {
  for (const identifier of [
    'PermissionHelper',
    'permissionDirectory',
    'isPermissionHelperOpen',
    '@tauri-apps/plugin-dialog'
  ]) {
    assert.doesNotMatch(sidebar, new RegExp(identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(sidebar, /await loadDirectory\(targetPath\);/);
});
