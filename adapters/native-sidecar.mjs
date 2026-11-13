// Uses the agentapi entry point shipped with Google's documented Sidecars.
// Credentials remain in the environment injected by Antigravity itself.
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA, config, secret, atomic, redact } from '../core/settings.mjs';
const execute = promisify(execFile);
const key = secret();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
if (!process.env.ANTIGRAVITY_LS_ADDRESS || !process.env.ANTIGRAVITY_CSRF_TOKEN) throw new Error('Start this connector as an Antigravity Sidecar, not as a standalone process.');
const executable = process.env.ANTIGRAVITY_AGENTAPI_EXE;
async function agentapi(args) {
  const file = executable || 'agentapi';
  const argv = executable ? ['agentapi', ...args] : args;
  const env = { ...process.env };
  if (config().native.projectId) env.ANTIGRAVITY_PROJECT_ID = config().native.projectId;
  const { stdout } = await execute(file, argv, { env, timeout: 25000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  return stdout.trim() ? JSON.parse(stdout) : {};
}
const server = http.createServer(async (req, res) => {
  const respond = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  if (req.headers.authorization !== 'Bearer ' + key || req.headers.origin || req.headers['sec-fetch-site'] || req.headers.host !== '127.0.0.1:' + server.address().port) return respond(403, { error: 'Local authenticated bridge only' });
  try {
    if (req.url === '/health' && req.method === 'GET') return respond(200, { ok: true, native: true, projectConfigured: Boolean(config().native.projectId || process.env.ANTIGRAVITY_PROJECT_ID), capabilities: { cancel: false } });
    if (req.method !== 'POST') return respond(405, { error: 'POST required' });
    let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 200000) throw new Error('Request too large'); }
    const body = JSON.parse(text);
    if (req.url === '/metadata') {
      if (!uuid.test(body.session_id)) throw new Error('Invalid session ID');
      return respond(200, { ok: true, data: await agentapi(['get-conversation-metadata', body.session_id]) });
    }
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new Error('Missing prompt');
    if (req.url === '/new') {
      const args = ['new-conversation'];
      if (body.model) args.push('--model', body.model);
      if (body.title) args.push('--title', body.title);
      args.push('--', body.prompt);
      return respond(200, { ok: true, data: await agentapi(args) });
    }
    if (req.url === '/send') {
      if (!uuid.test(body.session_id)) throw new Error('Invalid session ID');
      return respond(200, { ok: true, data: await agentapi(['send-message', body.session_id, '--', body.prompt]) });
    }
    return respond(404, { error: 'Unknown endpoint' });
  } catch (error) { return respond(400, { error: redact(error.stderr || error.message, [key, process.env.ANTIGRAVITY_CSRF_TOKEN]) }); }
});
server.listen(0, '127.0.0.1', () => {
  atomic(path.join(DATA, 'native-connection.json'), JSON.stringify({ url: 'http://127.0.0.1:' + server.address().port, pid: process.pid }));
  console.log('Antigravity native bridge connector ready (loopback, authenticated).');
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
