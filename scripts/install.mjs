import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { ROOT, atomic, backup, secret, config } from '../core/settings.mjs';

export function codexConfiguration(text, node = process.execPath, root = ROOT) {
  const begin = '# BEGIN codex-to-antigravity-dev', end = '# END codex-to-antigravity-dev';
  const start = text.indexOf(begin), stop = text.indexOf(end);
  if ((start < 0) !== (stop < 0) || (start >= 0 && stop < start)) throw new Error('Incomplete development bridge markers');
  const block = `${begin}\n[mcp_servers.codex_to_antigravity_dev]\ncommand = ${JSON.stringify(node)}\nargs = [${JSON.stringify(path.join(root, 'codex-to-antigravity/mcp.mjs'))}]\nstartup_timeout_sec = 30\ntool_timeout_sec = 45\n${end}`;
  if (start >= 0) return text.slice(0, start) + block + text.slice(stop + end.length);
  if (/^\[mcp_servers\.codex_to_antigravity_dev\]/m.test(text)) throw new Error('Existing unowned MCP registration; not overwritten');
  return text.trimEnd() + '\n\n' + block + '\n';
}
export function dshConfiguration(text, root = ROOT) {
  const doc = YAML.parseDocument(text || '[]'); if (doc.errors.length || !YAML.isSeq(doc.contents)) throw new Error('Invalid DSH profile patch');
  const rows = doc.toJS(), module = path.join(root, 'dsh-to-antigravity/index.mjs');
  for (const row of rows) for (const entry of row?.insert || []) if (entry.id === 'dsh-to-antigravity-dev') {
    if (entry.name !== module) throw new Error('DSH development entry is owned by another installation'); return doc.toString();
  }
  doc.contents.add(doc.createNode({ insert: [{ id: 'dsh-to-antigravity-dev', name: module }] })); return doc.toString();
}
export function install(flavor) {
  if (!['codex', 'dsh', 'native', 'all'].includes(flavor)) throw new Error('Install target: codex | dsh | native | all');
  const writes = [];
  if (flavor === 'codex' || flavor === 'all') {
    const file = path.join(os.homedir(), '.codex/config.toml'); const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    writes.push([file, codexConfiguration(text)]);
  }
  if (flavor === 'dsh' || flavor === 'all') {
    const file = path.join(os.homedir(), '.dsh/profiles/desktop/cordis.patch.yml'); const text = fs.readFileSync(file, 'utf8'); writes.push([file, dshConfiguration(text)]);
  }
  if (flavor === 'native' || flavor === 'all') {
    const file = path.join(os.homedir(), '.gemini/config/mcp_config.json');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
    const value = text ? JSON.parse(text) : {};
    value.mcpServers ??= {}; const old = value.mcpServers.antigravity_bridge_reporter;
    const entry = path.join(ROOT, 'adapters/reporter-mcp.mjs');
    if (old && !old.args?.includes(entry)) throw new Error('Existing unowned reporter MCP; not overwritten');
    value.mcpServers.antigravity_bridge_reporter = { command: process.execPath, args: [entry] };
    writes.push([file, JSON.stringify(value, null, 2) + '\n']);
    const sidecar = path.join(os.homedir(), '.gemini/config/sidecars/antigravity-bridge-dev/sidecar.json');
    writes.push([sidecar, JSON.stringify({ command: process.execPath, args: [path.join(ROOT, 'adapters/native-sidecar.mjs')], restart_policy: 'on-failure', display_name: 'Antigravity Bridge Dev', description: 'Authenticated local DSH/Codex development bridge' }, null, 2)]);
    const globals = path.join(os.homedir(), '.gemini/config/config.json'); const settings = JSON.parse(fs.readFileSync(globals, 'utf8'));
    settings.sidecars ??= {}; settings.sidecars['antigravity-bridge-dev'] = { enabled: true, ...(config().native.projectId ? { projectId: config().native.projectId } : {}) };
    writes.push([globals, JSON.stringify(settings, null, 2) + '\n']);
  }
  const originals = writes.map(([file]) => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]);
  secret();
  try { for (const [file, contents] of writes) { backup(file); atomic(file, contents); } }
  catch (error) { for (const [file, old] of originals) { if (old) atomic(file, old); else if (fs.existsSync(file)) fs.unlinkSync(file); } throw error; }
  return { installed: flavor, filesUpdated: writes.length, existingConfigsPreserved: true };
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) console.log(JSON.stringify(install(process.argv[2] || 'all')));
