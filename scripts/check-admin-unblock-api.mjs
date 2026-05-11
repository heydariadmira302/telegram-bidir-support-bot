#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const root = process.cwd();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-support-unblock-'));
const dbPath = path.join(tmpDir, 'check.sqlite');
const db = new Database(dbPath);

function execSql(sql) {
  db.exec(sql);
}

for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  execSql(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'));
}

const userId = '900001';
db.prepare("INSERT OR IGNORE INTO workspaces (id, name) VALUES ('default', '默认工作区')").run();
db.prepare("INSERT OR IGNORE INTO bots (id, workspace_id, name, enabled, is_default) VALUES ('default', 'default', '默认 Bot', 1, 1)").run();
db.prepare(`
  INSERT INTO users (workspace_id, bot_id, user_chat_id, topic_id, first_name, is_blocked, created_at, updated_at, last_message_at)
  VALUES ('default', 'default', ?, 123, 'Blocked User', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`).run(userId);
db.prepare("INSERT INTO blocked_users (workspace_id, bot_id, user_chat_id, reason) VALUES ('default', 'default', ?, 'test')").run(userId);

const dbLike = {
  prepare(sql) {
    const stmt = db.prepare(sql);
    return {
      bind(...args) {
        return wrap(stmt, args);
      },
      first() { return stmt.get(); },
      all() { return { results: stmt.all() }; },
      run() { return stmt.run(); },
    };
  },
  async batch(items) {
    for (const item of items) item.run();
  },
};

function wrap(stmt, args) {
  return {
    first() { return stmt.get(...args); },
    all() { return { results: stmt.all(...args) }; },
    run() { return stmt.run(...args); },
  };
}

const { applyUserAction } = await import('../src/services/user.ts');
await applyUserAction({ DB: dbLike, WORKSPACE_ID: 'default', BOT_ID: 'default' }, userId, 'unblock');

const user = db.prepare("SELECT is_blocked FROM users WHERE workspace_id = 'default' AND bot_id = 'default' AND user_chat_id = ?").get(userId);
const blocked = db.prepare("SELECT COUNT(*) AS count FROM blocked_users WHERE workspace_id = 'default' AND bot_id = 'default' AND user_chat_id = ?").get(userId);

if (!user || user.is_blocked !== 0) throw new Error(`expected users.is_blocked=0, got ${user?.is_blocked}`);
if (blocked.count !== 0) throw new Error(`expected blocked_users row removed, got ${blocked.count}`);

console.log('OK admin unblock API/service path clears users.is_blocked and blocked_users row');
db.close();
fs.rmSync(tmpDir, { recursive: true, force: true });
