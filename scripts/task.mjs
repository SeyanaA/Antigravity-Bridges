import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { ROOT, config } from '../core/settings.mjs';
const [client, action, ...raw] = process.argv.slice(2);
const rest = raw.filter(value => value !== '--new-session');
if (!['codex', 'dsh'].includes(client) || !['submit', 'result', 'events', 'list', 'cancel', 'health'].includes(action)) throw new Error('Usage: node scripts/task.mjs codex|dsh submit|result|events|list|cancel|health [task-file|task-id]');
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, client + '-to-antigravity/mcp.mjs')], stderr: 'pipe' });
const mcp = new Client({ name: 'antigravity-bridge-dev-client', version: '0.1.0' });
try {
  await mcp.connect(transport);
  let name, args = {};
  if (action === 'submit') {
    const conversation_id = client === 'codex' ? process.env.CODEX_THREAD_ID : process.env.DSH_SESSION_ID;
    if (!conversation_id) throw new Error('Run from the actual source conversation with CODEX_THREAD_ID or DSH_SESSION_ID; do not invent it.');
    name = 'ag_submit_task'; args = { task: fs.readFileSync(rest[0], 'utf8'), conversation_id, workspace: rest[1] || config().allowedWorkspaces[0], new_session: raw.includes('--new-session'), timeout_seconds: 300 };
  } else if (action === 'result' || action === 'events' || action === 'cancel') {
    name = { result: 'ag_get_result', events: 'ag_get_events', cancel: 'ag_cancel_task' }[action]; args = { task_id: rest[0] };
  } else name = action === 'list' ? 'ag_list_tasks' : 'ag_health';
  const result = await mcp.callTool({ name, arguments: args });
  for (const block of result.content || []) if (block.type === 'text') console.log(block.text);
  if (result.isError) process.exitCode = 1;
} finally { await mcp.close(); }
