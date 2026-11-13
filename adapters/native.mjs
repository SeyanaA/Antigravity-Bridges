import fs from 'node:fs';
import path from 'node:path';
import { DATA, secret } from '../core/settings.mjs';
export class NativeAdapter {
  canCancel = false;
  async call(route, data) {
    const file = path.join(DATA, 'native-connection.json');
    if (!fs.existsSync(file)) throw new Error('Antigravity Desktop 连接器未运行，请启用开发版 Sidecar 并打开 Antigravity。');
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    const url = new URL(c.url); if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Invalid native connector address');
    const response = await fetch(url + route.slice(1), { method: data ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + secret(), 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(30000) });
    const body = await response.json(); if (!response.ok || !body.ok) throw new Error(body.error || 'Native connector failed'); return body.data ?? body;
  }
  async health() { try { return await this.call('/health'); } catch (error) { return { ok: false, error: error.message }; } }
  async start(task, prompt) {
    if (task.session_id) { await this.call('/send', { session_id: task.session_id, prompt }); return task.session_id; }
    const result = await this.call('/new', { prompt, model: task.model, title: `${task.client === 'codex' ? 'Codex' : 'DSH'} Bridge Dev · ${task.task.slice(0, 24)}` });
    function idOf(value) {
      if (!value || typeof value !== 'object') return null;
      for (const key of ['conversation_id', 'conversationId']) if (typeof value[key] === 'string') return value[key];
      for (const child of Object.values(value)) { const id = idOf(child); if (id) return id; } return null;
    }
    const id = idOf(result); if (!id) throw new Error('Native API did not return a conversation ID; not assuming success.'); return id;
  }
  metadata(id) { return this.call('/metadata', { session_id: id }); }
  cancel() { throw new Error('原生 agentapi 未提供取消接口；请在 Antigravity 停止会话。桥接器不会假装已取消。'); }
}
