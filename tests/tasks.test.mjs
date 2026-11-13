import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Tasks, publicTask } from '../core/tasks.mjs';
import { Storage } from '../core/storage.mjs';
const pause = () => new Promise(resolve => setTimeout(resolve, 12));
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-bridge-test-'));
  const workspace = path.join(directory, 'workspace'); fs.mkdirSync(workspace);
  const storage = new Storage(directory); const calls = [];
  const native = { canCancel: false, health: async () => ({ ok: true }), start: async (task, prompt) => { calls.push({ ...publicTask(task), prompt }); return task.session_id || randomUUID(); }, call: async () => ({ ok: true }) };
  const settings = { port: 0, backend: 'native', native: {}, cli: {}, allowedWorkspaces: [workspace], target: { approved: true, model: 'gemini-4-hydrogen-high', effort: 'high' } };
  const manager = new Tasks({ storage, settings, native });
  t.after(() => { for (const timer of manager.timers.values()) clearTimeout(timer); storage.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const spec = { task: 'hello', conversation_id: 'source-chat-0001', workspace };
  function complete(id, summary = '你好') { const task = storage.get(id); return manager.report({ task_id: id, report_token: task.report_token, status: 'completed', summary }); }
  return { directory, workspace, storage, settings, manager, calls, spec, complete };
}

test('new native tasks return immediately, redact private reporting keys and preserve source-chat mappings', async t => {
  const f = fixture(t); const first = f.manager.submit('codex', f.spec);
  assert.equal(first.status, 'QUEUED'); assert(!('report_token' in first));
  await pause(); let task = f.storage.get(first.id); assert.equal(task.status, 'RUNNING'); assert(task.session_id);
  assert.equal(task.model, 'gemini-4-hydrogen-high'); f.complete(first.id);
  const second = f.manager.submit('codex', { ...f.spec, task: 'continue' }); await pause();
  assert.equal(f.storage.get(second.id).session_id, task.session_id); f.complete(second.id);
  const other = f.manager.submit('dsh', f.spec); await pause();
  assert.notEqual(f.storage.get(other.id).session_id, task.session_id); f.complete(other.id);
  const fresh = f.manager.submit('codex', { ...f.spec, new_session: true }); await pause();
  assert.notEqual(f.storage.get(fresh.id).session_id, task.session_id); f.complete(fresh.id);
  assert.equal(f.storage.binding(task.binding_key).session_id, task.session_id);
  const rawEvents = JSON.stringify(f.storage.events(first.id)); assert(!rawEvents.includes(task.report_token));
});
test('workspaces are serialized, needs-input releases no false completion, and replies continue the same native task', async t => {
  const f = fixture(t); const first = f.manager.submit('codex', f.spec), second = f.manager.submit('dsh', f.spec); await pause();
  assert.equal(f.calls.length, 1); const task = f.storage.get(first.id);
  f.manager.report({ task_id: task.id, report_token: task.report_token, status: 'needs_input', summary: 'choose A or B' });
  assert.equal(f.storage.get(task.id).status, 'NEEDS_INPUT'); assert.equal(f.storage.get(second.id).status, 'QUEUED');
  await f.manager.message('codex', task.id, 'A'); assert.equal(f.storage.get(task.id).status, 'RUNNING');
  f.complete(task.id); await pause(); assert.equal(f.calls.length, 2); f.complete(second.id);
});
test('a completion token cannot be guessed, replayed or used for another task; callers cannot read another source', async t => {
  const f = fixture(t); const task = f.manager.submit('codex', f.spec); await pause();
  assert.throws(() => f.manager.report({ task_id: task.id, report_token: 'wrong', status: 'completed', summary: 'fake' }), /Invalid/);
  assert.throws(() => f.manager.owned('dsh', task.id), /not found/);
  f.complete(task.id); assert.throws(() => f.complete(task.id), /completed/);
});
test('native cancellation does not lie, queued jobs can cancel, and native timeout retains its unconfirmed execution lock', async t => {
  const f = fixture(t); const task = f.manager.submit('codex', f.spec); await pause();
  assert.throws(() => f.manager.cancel('codex', task.id), /原生接口没有取消/);
  const queued = f.manager.submit('dsh', f.spec); assert.equal(f.manager.cancel('dsh', queued.id).status, 'CANCELLED');
  f.manager.expire(task.id); assert.equal(f.storage.get(task.id).status, 'TIMED_OUT'); assert(f.storage.get(task.id).execution_unconfirmed);
  const later = f.manager.submit('dsh', f.spec); await pause(); assert.equal(f.storage.get(later.id).status, 'QUEUED');
});
test('restart persists records, marks unfinished native work interrupted and never replays it', async t => {
  const f = fixture(t); const task = f.manager.submit('codex', f.spec); await pause();
  const resumed = new Tasks({ storage: f.storage, settings: f.settings, native: f.manager.native });
  assert.equal(resumed.storage.get(task.id).status, 'INTERRUPTED'); assert(resumed.storage.get(task.id).execution_unconfirmed);
  await pause(); assert.equal(f.calls.length, 1);
});
test('invalid model policy, empty tasks, sibling path tricks and symlink escapes fail before any dispatch', async t => {
  const f = fixture(t);
  f.settings.target.approved = false; assert.throws(() => f.manager.submit('codex', f.spec), /模型映射尚未确认/); f.settings.target.approved = true;
  assert.throws(() => f.manager.submit('codex', { ...f.spec, task: '' }), /Task/);
  const outside = path.join(f.directory, 'workspace-evil'); fs.mkdirSync(outside); const link = path.join(f.workspace, 'outside'); fs.symlinkSync(outside, link);
  for (const workspace of [outside, link]) assert.throws(() => f.manager.submit('codex', { ...f.spec, workspace }), /allowlist/);
  await pause(); assert.equal(f.calls.length, 0);
});
