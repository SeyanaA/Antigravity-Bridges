import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, DATA, config, childEnvironment } from './settings.mjs';
import { clientKey } from './service.mjs';

export async function api(role, route, body) {
  const response = await fetch(`http://127.0.0.1:${config().port}/api` + route, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + clientKey(role), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(35000) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Bridge request failed'); return value;
}
export async function ensureService() {
  try { const h = await api('admin', '/health'); if (h.service !== 'antigravity-bridge-dev') throw new Error('Unexpected service on configured port'); return h; }
  catch (error) { if (error.message.includes('authentication') || error.message.includes('Unexpected')) throw error; }
  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(DATA, 'service.log'), 'a', 0o600);
  const child = spawn(config().nodeExecutable || process.execPath, [path.join(ROOT, 'core/service.mjs')], { cwd: ROOT, env: childEnvironment(), detached: true, stdio: ['ignore', log, log], windowsHide: true }); child.unref(); fs.closeSync(log);
  child.on('error', () => {});
  for (let i = 0; i < 40; i++) {
    try { const h = await api('admin', '/health'); if (h.service === 'antigravity-bridge-dev') return h; } catch {}
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  throw new Error('Bridge service failed to start; inspect data/service.log. Existing port owner was not stopped.');
}
