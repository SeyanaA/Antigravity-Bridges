import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { childEnvironment } from '../core/settings.mjs';
export class CliAdapter {
  canCancel = true;
  constructor(settings) { this.settings = settings; this.children = new Map(); }
  run(task, onEvent, finish) {
    const args = ['--print', task.task, '--output-format', 'stream-json', '--model', task.model, '--print-timeout', `${task.timeout_seconds}s`, '--disable-slash-commands', '--sandbox', '--settings', '{"toolPermission":"request-review"}'];
    if (task.effort) args.push('--effort', task.effort);
    if (task.session_id) args.push('--conversation', task.session_id);
    const child = spawn(this.settings.executable, args, { cwd: task.workspace, env: childEnvironment(), detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.children.set(task.id, child);
    const decoder = new StringDecoder('utf8'); let buffer = '', result = null, stderr = '';
    const line = raw => {
      if (!raw.trim()) return;
      try { const event = JSON.parse(raw); onEvent(event.event || 'cli', event); if (event.event === 'result') result = event.result; }
      catch { onEvent('cli-output', { text: raw.slice(0, 8000) }); }
    };
    child.stdout.on('data', chunk => { buffer += decoder.write(chunk); let at; while ((at = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, at)); buffer = buffer.slice(at + 1); } if (buffer.length > 2e6) { this.cancel(task.id); finish(new Error('CLI event exceeds 2 MiB')); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16000); onEvent('cli-diagnostic', { text: chunk.toString() }); });
    child.once('error', error => { this.children.delete(task.id); finish(error); });
    child.once('close', code => {
      this.children.delete(task.id); line(buffer + decoder.end());
      if (result?.status === 'SUCCESS') finish(null, { summary: result.response, session_id: result.conversation_id, usage: result.usage ?? null });
      else finish(new Error(result?.error || `CLI ${result?.status || 'exited without final result'} (exit ${code}). ${stderr}`));
    });
  }
  cancel(id) {
    const child = this.children.get(id); if (!child) return;
    if (process.platform === 'win32') child.kill('SIGTERM'); else { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {} } }, 2000); force.unref();
  }
}
