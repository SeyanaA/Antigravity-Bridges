import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { Storage } from './storage.mjs';
import { config, redact } from './settings.mjs';
import { NativeAdapter } from '../adapters/native.mjs';
import { CliAdapter } from '../adapters/cli.mjs';
export const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'INTERRUPTED']);
export function publicTask(task) { if (!task) return null; const { report_token, binding_key, ...rest } = task; return rest; }
function equal(left, right) { const a = Buffer.from(left || ''), b = Buffer.from(right || ''); return a.length === b.length && timingSafeEqual(a, b); }
export class Tasks {
  constructor({ storage = new Storage(), settings = config(), native = new NativeAdapter(), cli } = {}) {
    this.storage = storage; this.settings = settings; this.native = native; this.cli = cli || new CliAdapter(settings.cli); this.timers = new Map(); this.busy = false;
    for (const task of storage.list(undefined, 0)) if (['RUNNING', 'NEEDS_INPUT'].includes(task.status)) { task.status = 'INTERRUPTED'; task.execution_unconfirmed = true; task.error = '桥接服务已重启，未确认任务是否结束；请检查执行端。未自动重跑。'; this.save(task, 'interrupted', { error: task.error }); }
    queueMicrotask(() => this.pump());
  }
  save(task, type, data = {}) { task.updated_at = new Date().toISOString(); this.storage.put(task); this.storage.event(task, type, data); }
  owned(client, id) { const task = this.storage.get(id); if (!task || (client !== 'dashboard' && task.client !== client)) throw new Error('Task not found for this bridge'); return task; }
  validateWorkspace(workspace) {
    if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw new Error('workspace must be absolute');
    const real = fs.realpathSync(workspace);
    if (!this.settings.allowedWorkspaces.some(root => { const rel = path.relative(fs.realpathSync(root), real); return !rel.startsWith('..') && !path.isAbsolute(rel); })) throw new Error('Workspace is not in the bridge allowlist');
    return real;
  }
  submit(client, spec) {
    if (!['codex', 'dsh'].includes(client)) throw new Error('Invalid caller');
    if (typeof spec.task !== 'string' || !spec.task.trim() || spec.task.length > 64000) throw new Error('Task must contain 1–64000 characters');
    if (typeof spec.conversation_id !== 'string' || !/^[a-zA-Z0-9_-]{8,160}$/.test(spec.conversation_id)) throw new Error('Pass the actual source conversation ID');
    const workspace = this.validateWorkspace(spec.workspace);
    const target = this.settings.target;
    if (!target?.model || !target?.approved) throw new Error('目标模型映射尚未确认；不会猜测、降档或换模型。');
    const backend = this.settings.backend;
    if (!['native', 'cli'].includes(backend)) throw new Error('Unsupported backend');
    const key = JSON.stringify([client, spec.conversation_id, workspace, backend]);
    const task = { id: 'ag-' + randomUUID(), client, conversation_id: spec.conversation_id, task: spec.task, workspace, backend,
      binding_key: key, new_session: spec.new_session === true, session_id: null, model: target.model, effort: target.effort,
      status: 'QUEUED', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), result: null, error: null,
      timeout_seconds: Math.min(1800, Math.max(10, spec.timeout_seconds || 300)), can_cancel: backend === 'cli', usage: null, files_changed: [],
      report_token: randomBytes(24).toString('hex') };
    this.save(task, 'submitted', { client, conversation_id: task.conversation_id, task: task.task, backend, model: task.model, effort: task.effort });
    queueMicrotask(() => this.pump()); return publicTask(task);
  }
  async pump() {
    if (this.busy) return;
    const tasks = this.storage.list(undefined, 0).reverse();
    const task = tasks.find(t => t.status === 'QUEUED' && !tasks.some(other => (['RUNNING', 'NEEDS_INPUT'].includes(other.status) || other.execution_unconfirmed) && (other.workspace === t.workspace || other.binding_key === t.binding_key)));
    if (!task) return; this.busy = true;
    try {
      const bound = task.new_session ? null : this.storage.binding(task.binding_key);
      if (bound) { if (bound.model !== task.model) throw new Error('已有桥接会话模型与当前要求不同，请明确新建会话。'); task.session_id = bound.session_id; }
      task.status = 'RUNNING'; this.save(task, 'started', { backend: task.backend, continued: Boolean(task.session_id) });
      const timer = setTimeout(() => this.expire(task.id), task.timeout_seconds * 1000); timer.unref(); this.timers.set(task.id, timer);
      if (task.backend === 'cli') {
        this.cli.run(task, (type, data) => this.storage.event(this.storage.get(task.id), type, data), (error, result) => this.finish(task.id, error, result));
      } else {
        const prompt = `${task.task}\n\n[Bridge protocol — task ${task.id}]\nYou are running inside Antigravity Desktop. Caller: ${task.client}. Complete only the requested task. Do not delegate recursively. Do not change models or permission settings. MCP tools may be deferred: first use the available tool search/discovery mechanism to discover ag_report_result by name if it is not directly listed. You MUST return the result through MCP server antigravity_bridge_reporter, tool ag_report_result, before your final reply. Use task_id=${task.id}, report_token=${task.report_token}, status=completed (or needs_input/failed), and summary containing your actual result. Never claim a test was run unless it was actually run. For this task keep all file operations within ${task.workspace}. If this is only a greeting, use no file, shell, network or browser tools. If the reporter tool is unavailable or needs approval, explicitly say so; do not claim the bridge has received a result. The bridge has not granted any additional permissions.`;
        task.execution_unconfirmed = true; this.storage.put(task);
        const sessionId = await this.native.start(task, prompt);
        const fresh = this.storage.get(task.id); fresh.session_id = sessionId;
        if (!task.new_session) this.storage.bind(task.binding_key, sessionId, task.model);
        this.save(fresh, 'native-session', { session_id: sessionId });
      }
    } catch (error) { this.finish(task.id, error); }
    finally { this.busy = false; queueMicrotask(() => this.pump()); }
  }
  finish(id, error, result) {
    const task = this.storage.get(id); if (!task || TERMINAL.has(task.status)) return;
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    if (error) { task.status = 'FAILED'; task.error = redact(error.message, [task.report_token]); }
    else {
      task.status = 'COMPLETED'; task.result = result.summary; task.usage = result.usage || null; task.execution_unconfirmed = false;
      if (result.session_id) task.session_id = result.session_id;
      if (task.session_id && !task.new_session) this.storage.bind(task.binding_key, task.session_id, task.model);
    }
    this.save(task, task.status.toLowerCase(), { result: task.result, error: task.error, usage: task.usage }); queueMicrotask(() => this.pump());
  }
  report(spec) {
    const task = this.storage.get(spec.task_id);
    if (!task || !equal(task.report_token, spec.report_token) || TERMINAL.has(task.status)) throw new Error('Invalid, expired or completed task report');
    if (task.backend !== 'native') throw new Error('CLI tasks finish through real CLI events');
    if (!['completed', 'failed', 'needs_input'].includes(spec.status) || typeof spec.summary !== 'string' || spec.summary.length > 100000) throw new Error('Invalid report');
    if (spec.status === 'needs_input') { task.status = 'NEEDS_INPUT'; task.result = spec.summary; this.save(task, 'needs-input', { question: spec.summary }); }
    else { task.execution_unconfirmed = false; this.storage.put(task); this.finish(task.id, spec.status === 'failed' ? new Error(spec.summary) : null, { summary: spec.summary }); }
    return { received: true, task_id: task.id, status: this.storage.get(task.id).status };
  }
  async message(client, id, text) {
    const task = this.owned(client, id);
    if (task.backend !== 'native' || task.status !== 'NEEDS_INPUT' || !task.session_id) throw new Error('Only a native NEEDS_INPUT task accepts a follow-up');
    if (typeof text !== 'string' || !text.trim() || text.length > 64000) throw new Error('Invalid follow-up');
    await this.native.call('/send', { session_id: task.session_id, prompt: text }); task.status = 'RUNNING'; this.save(task, 'caller-message', { text }); return publicTask(task);
  }
  cancel(client, id) {
    const task = this.owned(client, id); if (TERMINAL.has(task.status)) return publicTask(task);
    if (task.status !== 'QUEUED' && !task.can_cancel) throw new Error('请在 Antigravity Desktop 停止；原生接口没有取消能力，不会假装已停止。');
    this.cli.cancel(id); clearTimeout(this.timers.get(id)); task.status = 'CANCELLED'; this.save(task, 'cancelled'); queueMicrotask(() => this.pump()); return publicTask(task);
  }
  expire(id) {
    const task = this.storage.get(id); if (!task || TERMINAL.has(task.status)) return;
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    if (task.backend === 'cli') this.cli.cancel(id);
    task.status = 'TIMED_OUT'; task.error = task.backend === 'native' ? '等待回传超时；Antigravity 可能仍在执行，请到原生应用检查。未自动重跑。' : 'CLI 已超时并终止。';
    task.execution_unconfirmed = task.backend === 'native';
    this.save(task, 'timed-out', { error: task.error });
  }
}
