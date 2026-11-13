import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA, redact } from './settings.mjs';

export class Storage {
  constructor(directory = DATA) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(directory, 'tasks.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,client TEXT NOT NULL,state TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bindings(key TEXT PRIMARY KEY,session_id TEXT NOT NULL,model TEXT NOT NULL);`);
  }
  put(task) { this.db.prepare('INSERT OR REPLACE INTO tasks VALUES(?,?,?,?)').run(task.id, task.client, task.status, JSON.stringify(task)); }
  get(id) { const row = this.db.prepare('SELECT body FROM tasks WHERE id=?').get(id); return row ? JSON.parse(row.body) : null; }
  list(client, limit = 200) {
    const suffix = Number.isInteger(limit) && limit > 0 ? ` LIMIT ${limit}` : '';
    const rows = client ? this.db.prepare('SELECT body FROM tasks WHERE client=? ORDER BY rowid DESC' + suffix).all(client) : this.db.prepare('SELECT body FROM tasks ORDER BY rowid DESC' + suffix).all();
    return rows.map(row => JSON.parse(row.body));
  }
  event(task, type, data) {
    const value = { created_at: new Date().toISOString(), type, data: JSON.parse(redact(data, [task.report_token])) };
    const row = this.db.prepare('INSERT INTO events(task_id,body) VALUES(?,?)').run(task.id, JSON.stringify(value));
    return { id: Number(row.lastInsertRowid), ...value };
  }
  events(id, after = 0) { return this.db.prepare('SELECT id,body FROM events WHERE task_id=? AND id>? ORDER BY id LIMIT 1000').all(id, after).map(row => ({ id: row.id, ...JSON.parse(row.body) })); }
  bind(key, id, model) { this.db.prepare('INSERT OR REPLACE INTO bindings VALUES(?,?,?)').run(key, id, model); }
  binding(key) { return this.db.prepare('SELECT session_id,model FROM bindings WHERE key=?').get(key); }
  close() { this.db.close(); }
}
