import test from 'node:test';
import assert from 'node:assert/strict';
import { codexConfiguration, dshConfiguration } from '../scripts/install.mjs';
test('Codex configuration is additive and repeatable without replacing existing bridges', () => {
  const old = '[mcp_servers.dsh_desktop_crew]\ncommand="keep-this"\n';
  const next = codexConfiguration(old, '/node', '/project with spaces');
  assert(next.includes(old.trim())); assert(next.includes('codex_to_antigravity_dev'));
  assert.equal(codexConfiguration(next, '/node', '/project with spaces'), next);
  assert.throws(() => codexConfiguration('[mcp_servers.codex_to_antigravity_dev]\ncommand="other"'), /unowned/);
  assert.throws(() => codexConfiguration('# BEGIN codex-to-antigravity-dev\n'), /Incomplete/);
});
test('DSH insertion preserves original plugin settings and refuses foreign ownership', () => {
  const old = '# keep this comment\n- id: dsh-lock\n  config:\n    enabled: true\n';
  const next = dshConfiguration(old, '/project'); assert(next.includes('# keep this comment')); assert(next.includes('dsh-lock'));
  assert.equal(dshConfiguration(next, '/project'), next);
  assert.throws(() => dshConfiguration(next, '/different'), /another installation/);
  assert.throws(() => dshConfiguration('bad: [format'), /Invalid/);
});
