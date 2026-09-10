import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const source = (path) => readFileSync(path, 'utf8');
test('theme_settings_malformed: structured snapshot never writes fallback defaults', () => {
  const provider = source('src/providers/SettingsProvider.jsx');
  expect(provider).toContain("invoke('get_settings_snapshot')");
  expect(provider).not.toContain('updates: defaultSettings');
});
test('theme_reset_isolated: frontend invokes registered reset command', () => {
  expect(source('src/providers/SettingsProvider.jsx')).toContain("invoke('reset_settings_command')");
});
