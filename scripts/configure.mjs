import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, atomic, backup } from '../core/settings.mjs';
const [projectId, workspaceArg] = process.argv.slice(2);
if (!projectId || !/^[a-zA-Z0-9_-]{8,160}$/.test(projectId)) throw new Error('Usage: node scripts/configure.mjs <actual Antigravity project ID> [workspace]');
const workspace = path.resolve(workspaceArg || path.join(ROOT, 'workspaces'));
fs.mkdirSync(workspace, { recursive: true });
const contents = fs.readdirSync(workspace);
if (contents.every(name => name === '.gitkeep')) {
  try { execFileSync('git', ['init', '--initial-branch=codex/antigravity-dev', workspace], { stdio: 'pipe' }); }
  catch { throw new Error('空白工作目录需要 Git 建立独立审查边界，请先安装 Git。'); }
}
const file = path.join(ROOT, 'config/local.json');
const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
backup(file);
atomic(file, JSON.stringify({ ...previous, backend: 'native', native: { projectId }, allowedWorkspaces: [fs.realpathSync(workspace)], target: { model: 'gemini-4-hydrogen-high', effort: 'high', label: 'Gemini 4 Hydrogen (High)', approved: true } }, null, 2) + '\n');
console.log('已配置 Hydrogen High 和专用工作目录；尚未更改任何应用设置。');
