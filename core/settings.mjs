import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const ROOT = process.env.AG_BRIDGE_ROOT || fileURLToPath(new URL('..', import.meta.url));
export const DATA = path.join(ROOT, 'data');
export function config() {
  const file = path.join(ROOT, 'config/local.json');
  const local = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return { port: 3092, backend: 'native', native: {}, cli: { executable: path.join(ROOT, 'runtime/bin/agy') }, allowedWorkspaces: [path.join(ROOT, 'workspaces')], ...local };
}
export function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, value, { mode: 0o600 }); fs.renameSync(temporary, file);
}
export function secret() {
  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  const file = path.join(DATA, 'bridge.key');
  try { fs.writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return fs.readFileSync(file, 'utf8').trim();
}
export function redact(value, extra = []) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const token of extra.filter(Boolean)) text = text.split(token).join('[redacted]');
  return text.replace(/\bsk-[\w-]{12,}/g, '[redacted]').replace(/([?&](?:token|access_token|key)=)[^\s&#]+/gi, '$1[redacted]').replace(/(Bearer\s+)[\w.-]+/gi, '$1[redacted]');
}
export function backup(file) {
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.backup-' + Date.now());
}
export function childEnvironment(extra = {}) {
  const names = ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS'];
  return { ...Object.fromEntries(names.filter(k => process.env[k]).map(k => [k, process.env[k]])), AG_BRIDGE_ROOT: ROOT, ...extra };
}
