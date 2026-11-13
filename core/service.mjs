import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config, ROOT, DATA, secret, atomic, redact } from './settings.mjs';
import { Tasks, publicTask, TERMINAL } from './tasks.mjs';

export function clientKey(role, key = secret()) { return createHmac('sha256', key).update('antigravity-bridge-dev:' + role).digest('hex'); }
function equal(a, b) { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x, y); }
export async function startService({ settings = config(), tasks = new Tasks({ settings }), authenticationSecret = secret(), stateDirectory = DATA } = {}) {
  const roles = ['admin', 'codex', 'dsh', 'reporter'];
  const tokens = Object.fromEntries(roles.map(role => [role, clientKey(role, authenticationSecret)]));
  const cookie = clientKey('dashboard', authenticationSecret);
  let stopping = false;
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' }); res.end(JSON.stringify(body)); };
    try {
      const validHosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
      if (!validHosts.includes(req.headers.host)) return send(403, { error: 'Invalid Host' });
      if (req.headers.origin && !validHosts.some(host => req.headers.origin === 'http://' + host)) return send(403, { error: 'Cross-origin access denied' });
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/' && req.method === 'GET') {
        if (req.headers['sec-fetch-site'] && !['none', 'same-origin'].includes(req.headers['sec-fetch-site'])) return send(403, { error: 'Open the monitor directly in the address bar' });
        const page = path.join(ROOT, 'dashboard/index.html');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': `ag_bridge_dashboard=${cookie}; HttpOnly; SameSite=Strict; Path=/`, 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' });
        return res.end(fs.existsSync(page) ? fs.readFileSync(page) : '<h1>Antigravity Bridge Dev</h1><p>Monitor is being installed.</p>');
      }
      let role = roles.find(role => equal(req.headers.authorization, 'Bearer ' + tokens[role]));
      if (!role && req.headers.cookie?.split(';').some(part => equal(part.trim(), 'ag_bridge_dashboard=' + cookie))) role = 'dashboard';
      if (!role) return send(401, { error: 'Bridge authentication required' });
      let body = {};
      if (req.method === 'POST') {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 160000) throw new Error('Request too large'); }
        body = raw ? JSON.parse(raw) : {};
      }
      if (url.pathname === '/api/health' && req.method === 'GET') {
        const native = await tasks.native.health();
        return send(200, { ok: true, service: 'antigravity-bridge-dev', version: '0.1.0-dev.1', backend: settings.backend, nativeConnected: native.ok === true, capabilities: { cancel: settings.backend === 'cli' }, target: settings.target ?? null });
      }
      if (url.pathname === '/api/report' && req.method === 'POST' && ['reporter', 'admin'].includes(role)) return send(200, tasks.report(body));
      if (url.pathname === '/api/admin/stop' && req.method === 'POST' && role === 'admin') {
        if (tasks.storage.list(undefined, 0).some(t => ['RUNNING', 'NEEDS_INPUT'].includes(t.status) || t.execution_unconfirmed)) return send(409, { error: 'Tasks are active or unconfirmed. Check and stop them in the execution application before stopping the bridge.' });
        send(200, { stopped: true }); stopping = true; server.close(); return;
      }
      if (role === 'reporter') return send(403, { error: 'Reporter only accepts completion reports' });
      const match = url.pathname.match(/^\/api\/tasks(?:\/([a-z0-9-]+)(?:\/(events|message|cancel|confirm-stopped))?)?$/);
      if (!match) return send(404, { error: 'Unknown endpoint' });
      const [, id, action] = match;
      if (!id && req.method === 'GET') return send(200, { tasks: tasks.storage.list(role === 'dashboard' || role === 'admin' ? undefined : role).map(publicTask) });
      if (!id && req.method === 'POST' && ['codex', 'dsh'].includes(role)) return send(202, tasks.submit(role, body));
      if (!id) return send(405, { error: 'Operation not permitted' });
      const task = tasks.owned(role === 'admin' ? 'dashboard' : role, id);
      if (!action && req.method === 'GET') return send(200, { task: publicTask(task) });
      if (action === 'events' && req.method === 'GET') return send(200, { events: tasks.storage.events(id, Number(url.searchParams.get('after')) || 0) });
      if (action === 'cancel' && req.method === 'POST') return send(200, tasks.cancel(role === 'admin' ? 'dashboard' : role, id));
      if (action === 'message' && req.method === 'POST' && ['codex', 'dsh'].includes(role)) return send(200, await tasks.message(role, id, body.message));
      if (action === 'confirm-stopped' && req.method === 'POST' && ['codex', 'dsh', 'admin'].includes(role) && body.confirmed === true) {
        if (!TERMINAL.has(task.status)) return send(409, { error: 'Only an interrupted or timed-out task can be acknowledged' });
        task.execution_unconfirmed = false; tasks.save(task, 'caller-confirmed-stopped'); queueMicrotask(() => tasks.pump()); return send(200, { task: publicTask(task) });
      }
      return send(405, { error: 'Unsupported operation' });
    } catch (error) { return send(400, { error: redact(error.message, [secret(), ...Object.values(tokens)]) }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(settings.port, '127.0.0.1', resolve); });
  atomic(path.join(stateDirectory, 'service.json'), JSON.stringify({ pid: process.pid, port: server.address().port, service: 'antigravity-bridge-dev' }));
  return { server, tasks, close: () => new Promise(resolve => server.close(resolve)) };
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const running = await startService();
  console.log('Antigravity Bridge Dev listening on localhost:' + running.server.address().port);
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    for (const task of running.tasks.storage.list(undefined, 0)) if (['RUNNING', 'NEEDS_INPUT'].includes(task.status)) {
      if (task.backend === 'cli') running.tasks.cli.cancel(task.id);
      task.status = 'INTERRUPTED'; task.execution_unconfirmed = task.backend === 'native'; running.tasks.save(task, 'service-stopped');
    }
    running.server.close(() => process.exit(0));
  });
}
