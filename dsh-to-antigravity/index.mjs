// DSH-native tool definitions are plain JSON plus executors. No host packages
// are imported, preserving the host's module realm and symbol identity.
import { ensureService, api } from '../core/client.mjs';
import { config } from '../core/settings.mjs';
export const name = 'dsh-to-antigravity-dev';
export const inject = ['tools'];
export function callerSession(exec) {
  const id = exec.agent?.session?.id;
  if (typeof id !== "string" || !id) throw new Error("This tool requires a real calling DSH agent Session.");
  return id;
}
export async function apply(ctx, { connect = ensureService, request = api, settings = config } = {}) {
  function register(name, description, properties, required, handler) {
    ctx.tools.register({ name, description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const session = callerSession(exec);
        await connect();
        return JSON.stringify(await handler(args, session));
      },
    });
    // tools.register is already owned by this Cordis context and disposed by it.
  }
  const id = { type: 'string', description: 'Task ID returned by antigravity_submit_task.' };
  register('antigravity_submit_task', 'Delegate an independent task to Antigravity Desktop (Hydrogen High). Returns immediately. Calling DSH Session ID is bound automatically. Poll and review results; do not automatically merge. New sessions only when the user asks.', {
    task: { type: 'string' }, workspace: { type: 'string', description: 'Allowed target workspace; omit for the configured development workspace.' }, new_session: { type: 'boolean' },
  }, ['task'], (args, conversation_id) => request('dsh', '/tasks', { ...args, conversation_id, workspace: args.workspace || settings().allowedWorkspaces[0] }));
  for (const [tool, action, description] of [
    ['antigravity_get_result', '', 'Read the actual returned task result and model. RUNNING is not completion.'],
    ['antigravity_get_events', '/events', 'Read real bridge events for this DSH task.'],
  ]) register(tool, description, { task_id: id }, ['task_id'], args => request('dsh', '/tasks/' + encodeURIComponent(args.task_id) + action));
  register('antigravity_send_message', 'Answer a NEEDS_INPUT question in the original Antigravity session.', { task_id: id, message: { type: 'string' } }, ['task_id', 'message'], args => request('dsh', '/tasks/' + encodeURIComponent(args.task_id) + '/message', { message: args.message }));
  register('antigravity_cancel_task', 'Cancel a queued task. Running native conversations must be stopped manually in Antigravity; the bridge will return an explicit unsupported error.', { task_id: id }, ['task_id'], args => request('dsh', '/tasks/' + encodeURIComponent(args.task_id) + '/cancel', {}));
  register('antigravity_list_tasks', 'List tasks sent through the DSH development bridge only.', {}, [], () => request('dsh', '/tasks'));
}
