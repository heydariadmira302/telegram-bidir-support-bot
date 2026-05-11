#!/usr/bin/env node
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = process.argv[2] || process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'telegram-support-bot.sqlite');
const db = new Database(dbPath, { readonly: true });

const botScopedTables = ['users', 'message_links', 'message_logs', 'blocked_users', 'quick_replies', 'keyword_replies', 'broadcasts', 'broadcast_results', 'sensitive_words'];
const workspaceScopedTables = ['settings', 'admins', 'audit_logs'];
const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
function exists(table, database = db) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
function columns(table, database = db) {
  if (!exists(table, database)) return [];
  return database.prepare(`PRAGMA table_info(${table})`).all();
}
function indexes(table, database = db) {
  if (!exists(table, database)) return [];
  return database.prepare(`PRAGMA index_list(${table})`).all();
}
function indexCols(indexName, database = db) {
  return database.prepare(`PRAGMA index_info(${JSON.stringify(indexName)})`).all().map((x) => x.name);
}
function hasUniqueCovering(table, wanted, database = db) {
  const pk = columns(table, database).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  if (sameSet(pk, wanted)) return true;
  return indexes(table, database).some((idx) => idx.unique && sameSet(indexCols(idx.name, database), wanted));
}
function sameSet(actual, wanted) {
  return actual.length === wanted.length && wanted.every((x) => actual.includes(x));
}
function pkCols(table, database = db) {
  return columns(table, database).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
}

check('database exists', fs.existsSync(dbPath), dbPath);
check('default workspace exists', Boolean(db.prepare("SELECT 1 FROM workspaces WHERE id='default'").get()));
check('default bot exists', Boolean(db.prepare("SELECT 1 FROM bots WHERE id='default' AND workspace_id='default'").get()));
check('workspace_admins exists', exists('workspace_admins'));
if (exists('workspace_admins')) {
  check('workspace_admins unique/PK covers workspace_id, user_id', hasUniqueCovering('workspace_admins', ['workspace_id', 'user_id']));
  const blank = db.prepare("SELECT COUNT(*) AS n FROM workspace_admins WHERE workspace_id IS NULL OR workspace_id = '' OR user_id IS NULL OR user_id = ''").get();
  check('workspace_admins has no blank membership keys', blank.n === 0, blank.n ? `${blank.n} rows` : '');
}

for (const table of [...workspaceScopedTables, ...botScopedTables]) check(`${table} exists`, exists(table));

for (const col of ['workspace_id', 'bot_id', 'key', 'value']) check(`settings.${col} exists`, columns('settings').some((x) => x.name === col));
check('settings unique/PK covers workspace_id, bot_id, key', hasUniqueCovering('settings', ['workspace_id', 'bot_id', 'key']));

for (const table of botScopedTables) {
  const actual = new Set(columns(table).map((x) => x.name));
  check(`${table}.workspace_id exists`, actual.has('workspace_id'));
  check(`${table}.bot_id exists`, actual.has('bot_id'));
  if (actual.has('workspace_id') && actual.has('bot_id')) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id IS NULL OR workspace_id = '' OR bot_id IS NULL OR bot_id = ''`).get();
    check(`${table} has no tenant blank values`, row.n === 0, row.n ? `${row.n} rows` : '');
  }
}

for (const table of workspaceScopedTables) {
  const actual = new Set(columns(table).map((x) => x.name));
  check(`${table}.workspace_id exists`, actual.has('workspace_id'));
  if (actual.has('workspace_id')) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id IS NULL OR workspace_id = ''`).get();
    check(`${table} has no blank workspace_id`, row.n === 0, row.n ? `${row.n} rows` : '');
  }
}

check('users PK is tenant scoped, not user_chat_id only', !sameSet(pkCols('users'), ['user_chat_id']) && hasUniqueCovering('users', ['workspace_id', 'bot_id', 'user_chat_id']), pkCols('users').join(','));
check('quick_replies PK is tenant scoped, not key only', !sameSet(pkCols('quick_replies'), ['key']) && hasUniqueCovering('quick_replies', ['workspace_id', 'bot_id', 'key']), pkCols('quick_replies').join(','));
check('keyword_replies PK is tenant scoped, not keyword only', !sameSet(pkCols('keyword_replies'), ['keyword']) && hasUniqueCovering('keyword_replies', ['workspace_id', 'bot_id', 'keyword']), pkCols('keyword_replies').join(','));
check('broadcasts PK is tenant scoped, not id only', !sameSet(pkCols('broadcasts'), ['id']) && hasUniqueCovering('broadcasts', ['workspace_id', 'bot_id', 'id']), pkCols('broadcasts').join(','));
check('message_links PK is tenant scoped, not support message only', !sameSet(pkCols('message_links'), ['support_chat_id', 'support_message_id']) && hasUniqueCovering('message_links', ['workspace_id', 'bot_id', 'support_chat_id', 'support_message_id']), pkCols('message_links').join(','));

for (const table of botScopedTables) {
  if (!exists(table)) continue;
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id != 'default' OR bot_id != 'default'`).get();
  check(`${table} old data is default/default`, row.n === 0, row.n ? `${row.n} non-default rows` : '');
}
if (exists('settings')) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM settings WHERE workspace_id != 'default' OR (bot_id IS NOT NULL AND bot_id != 'default')").get();
  check('settings old data is default/default or default/NULL', row.n === 0, row.n ? `${row.n} non-default rows` : '');
}

const riskQueries = [
  ['settings duplicate risk by tenant/key', "SELECT workspace_id, COALESCE(bot_id, '__global__') AS bot_key, key, COUNT(*) c FROM settings GROUP BY workspace_id, bot_key, key HAVING c > 1"],
  ['users duplicate risk by tenant/user', "SELECT workspace_id, bot_id, user_chat_id, COUNT(*) c FROM users GROUP BY workspace_id, bot_id, user_chat_id HAVING c > 1"],
  ['users topic duplicate risk by tenant/topic', "SELECT workspace_id, bot_id, topic_id, COUNT(*) c FROM users WHERE topic_id IS NOT NULL GROUP BY workspace_id, bot_id, topic_id HAVING c > 1"],
  ['message_links duplicate risk by tenant/message', "SELECT workspace_id, bot_id, support_chat_id, support_message_id, COUNT(*) c FROM message_links GROUP BY workspace_id, bot_id, support_chat_id, support_message_id HAVING c > 1"],
  ['quick_replies duplicate risk by tenant/key', "SELECT workspace_id, bot_id, key, COUNT(*) c FROM quick_replies GROUP BY workspace_id, bot_id, key HAVING c > 1"],
  ['keyword_replies duplicate risk by tenant/keyword', "SELECT workspace_id, bot_id, keyword, COUNT(*) c FROM keyword_replies GROUP BY workspace_id, bot_id, keyword HAVING c > 1"],
  ['broadcasts duplicate risk by tenant/id', "SELECT workspace_id, bot_id, id, COUNT(*) c FROM broadcasts GROUP BY workspace_id, bot_id, id HAVING c > 1"],
  ['broadcast_results duplicate risk by tenant/user', "SELECT workspace_id, bot_id, broadcast_id, user_chat_id, COUNT(*) c FROM broadcast_results GROUP BY workspace_id, bot_id, broadcast_id, user_chat_id HAVING c > 1"],
];
for (const [name, sql] of riskQueries) {
  const rows = db.prepare(sql).all();
  check(name, rows.length === 0, rows.length ? `${rows.length} duplicate groups` : '');
}

db.close();
runSmokeCheck(dbPath);

const failed = checks.filter((x) => !x.ok);
if (failed.length) {
  console.error(`\nTenant migration check failed: ${failed.length} issue(s).`);
  process.exit(1);
}
console.log('\nTenant migration check passed.');

function runSmokeCheck(sourcePath) {
  const temp = path.join(os.tmpdir(), `tenant-smoke-${process.pid}-${Date.now()}.sqlite`);
  fs.copyFileSync(sourcePath, temp);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(`${sourcePath}${suffix}`)) fs.copyFileSync(`${sourcePath}${suffix}`, `${temp}${suffix}`);
  }
  const smoke = new Database(temp);
  try {
    smoke.exec('BEGIN');
    smoke.prepare("INSERT OR IGNORE INTO workspaces (id, name) VALUES ('default', '默认工作区')").run();
    smoke.prepare("INSERT OR IGNORE INTO bots (id, workspace_id, name, enabled, is_default) VALUES ('test_bot', 'default', 'Smoke Bot', 1, 0)").run();
    smoke.prepare("INSERT INTO users (workspace_id, bot_id, user_chat_id, first_name, last_message_at, updated_at) VALUES ('default', 'default', 'tenant_smoke_user', 'Smoke Default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run();
    smoke.prepare("INSERT INTO users (workspace_id, bot_id, user_chat_id, first_name, last_message_at, updated_at) VALUES ('default', 'test_bot', 'tenant_smoke_user', 'Smoke Test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run();
    const n = smoke.prepare("SELECT COUNT(*) AS n FROM users WHERE workspace_id='default' AND user_chat_id='tenant_smoke_user'").get().n;
    check('smoke: same user_chat_id can exist in default and test_bot', n === 2, `${n} rows`);
    smoke.exec('ROLLBACK');
  } catch (err) {
    try { smoke.exec('ROLLBACK'); } catch {}
    check('smoke: same user_chat_id can exist in default and test_bot', false, err instanceof Error ? err.message : String(err));
  } finally {
    smoke.close();
    fs.rmSync(temp, { force: true });
  }
}
