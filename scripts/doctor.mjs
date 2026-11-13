import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT, config } from '../core/settings.mjs';
import { api, ensureService } from '../core/client.mjs';
const flavorFile = path.join(ROOT, 'flavor.json');
const flavor = fs.existsSync(flavorFile) ? JSON.parse(fs.readFileSync(flavorFile, 'utf8')).flavor : 'all';
let failed = false;
async function check(name, fn) { try { const value = await fn(); if (!value) throw new Error('未通过'); console.log('[OK] ' + name); } catch (e) { failed = true; console.log('[FAIL] ' + name + ': ' + e.message); } }
await check('Node 24 或更新版本', () => Number(process.versions.node.split('.')[0]) >= 24);
await check('目标模型为 Hydrogen High', () => config().target?.approved && config().target.model === 'gemini-4-hydrogen-high' && config().target.effort === 'high');
await check('工作目录存在', () => config().allowedWorkspaces.length && config().allowedWorkspaces.every(p => fs.statSync(p).isDirectory()));
if (flavor !== 'dsh') await check('Codex 注册', () => fs.readFileSync(path.join(os.homedir(), '.codex/config.toml'), 'utf8').includes(path.join(ROOT, 'codex-to-antigravity/mcp.mjs')));
if (flavor !== 'codex') await check('DSH 注册', () => YAML.parse(fs.readFileSync(path.join(os.homedir(), '.dsh/profiles/desktop/cordis.patch.yml'), 'utf8')).some(row => row.insert?.some(entry => entry.id === 'dsh-to-antigravity-dev' && entry.name === path.join(ROOT, 'dsh-to-antigravity/index.mjs'))));
await check('桥接器可启动且不调用模型', async () => (await ensureService()).ok);
await check('Antigravity 原生连接', async () => (await api('admin', '/health')).nativeConnected);
await check('任务存储已初始化', () => fs.existsSync(path.join(ROOT, 'data/tasks.sqlite')));
await check('监控页面可以访问', async () => (await fetch(`http://127.0.0.1:${config().port}/`)).ok);
await check('真实 stdio MCP 工具发现', async () => {
 const client = new Client({ name: 'bridge-doctor', version: '1.0' });
 try { await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'codex-to-antigravity/mcp.mjs')], stderr: 'pipe' })); return (await client.listTools()).tools.some(t => t.name === 'ag_submit_task'); }
 finally { await client.close(); }
});
console.log('说明：连接诊断不等于模型端到端验收；不会生成付费模型请求。');
process.exitCode = failed ? 1 : 0;
