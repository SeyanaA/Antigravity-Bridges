import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ensureService, api } from './client.mjs';

export async function startMcp(role) {
  if (!['codex', 'dsh', 'reporter'].includes(role)) throw new Error('Invalid bridge role');
  const server = new McpServer({ name: `${role}-to-antigravity-dev`, version: '0.1.0-dev.1' }, { instructions: role === 'reporter' ? 'Only report the outcome of the specific task using its report token. Do not submit or read unrelated tasks.' : 'Antigravity development bridge. Keep the source conversation ID exact. Default calls resume its mapped Antigravity session; different source clients/chats stay separate. Only request new_session when explicitly requested. Poll results and review changes; never auto-merge. Native cancellation is not supported by agentapi; use the Antigravity application. The bridge cannot wake the caller externally.' });
  function tool(name, description, inputSchema, handler) {
    server.registerTool(name, { description, inputSchema }, async args => {
      try { await ensureService(); const value = await handler(args); return { content: [{ type: 'text', text: JSON.stringify(value) }] }; }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    });
  }
  if (role === 'reporter') tool('ag_report_result', 'Return a completed result or blocking question for the exact bridge task. Does not approve file changes or prove that claimed tests passed.', {
    task_id: z.string(), report_token: z.string(), status: z.enum(['completed', 'failed', 'needs_input']), summary: z.string().max(100000),
  }, args => api(role, '/report', args));
  else {
    tool('ag_submit_task', 'Start an Antigravity task and return immediately. The result is pending until ag_get_result confirms completion.', {
      task: z.string().min(1).max(64000), conversation_id: z.string().min(8), workspace: z.string(), new_session: z.boolean().optional(), timeout_seconds: z.number().int().min(10).max(1800).optional(),
    }, args => {
      if (role === 'codex' && process.env.CODEX_THREAD_ID && args.conversation_id !== process.env.CODEX_THREAD_ID) throw new Error('conversation_id must equal the actual current CODEX_THREAD_ID');
      return api(role, '/tasks', args);
    });
    tool('ag_get_status', 'Read current task state, session, target model and error.', { task_id: z.string() }, args => api(role, '/tasks/' + encodeURIComponent(args.task_id)));
    tool('ag_get_result', 'Read the actual returned task result. RUNNING or NEEDS_INPUT is not completion. Review any actual file changes and tests yourself.', { task_id: z.string() }, args => api(role, '/tasks/' + encodeURIComponent(args.task_id)));
    tool('ag_get_events', 'Read real execution/report events; no fabricated progress.', { task_id: z.string(), after: z.number().int().min(0).optional() }, args => api(role, '/tasks/' + encodeURIComponent(args.task_id) + '/events?after=' + (args.after || 0)));
    tool('ag_send_message', 'Answer a NEEDS_INPUT question in the original native Antigravity conversation.', { task_id: z.string(), message: z.string().min(1).max(64000) }, args => api(role, '/tasks/' + encodeURIComponent(args.task_id) + '/message', { message: args.message }));
    tool('ag_cancel_task', 'Cancel a queued task or owned CLI process. Native agentapi cannot cancel running sessions; use Antigravity Desktop when required.', { task_id: z.string() }, args => api(role, '/tasks/' + encodeURIComponent(args.task_id) + '/cancel', {}));
    tool('ag_list_tasks', 'List only tasks submitted through this bridge source.', {}, () => api(role, '/tasks'));
    tool('ag_health', 'Check local bridge and native connector without calling a model.', {}, () => api(role, '/health'));
    tool('ag_confirm_stopped', 'Only after the user has stopped an interrupted/timed-out native task in Antigravity: acknowledge it to release its workspace lock. Do not claim you cancelled it.', { task_id: z.string(), confirmed: z.literal(true) }, args => api(role, '/tasks/' + encodeURIComponent(args.task_id) + '/confirm-stopped', { confirmed: args.confirmed }));
  }
  await server.connect(new StdioServerTransport());
}
