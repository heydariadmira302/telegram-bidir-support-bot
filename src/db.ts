import { botId, workspaceId } from './tenant';
import type { AdminRole, AdminRow, AuditLogRow, AiModelRow, AiProviderRow, BotRow, BroadcastResultRow, BroadcastRow, Env, KbEntryRow, KbRawMessageRow, KeywordReplyRow, MessageLogRow, QuickReplyRow, TelegramUser, UserRow, WorkspaceAdminRow, WorkspaceRow } from './types';

export async function listWorkspaces(db: D1Database): Promise<WorkspaceRow[]> {
  const res = await db.prepare('SELECT id, name, created_at, updated_at FROM workspaces ORDER BY created_at ASC').all<WorkspaceRow>();
  return res.results ?? [];
}

export async function getWorkspace(db: D1Database, id: string): Promise<WorkspaceRow | null> {
  return db.prepare('SELECT id, name, created_at, updated_at FROM workspaces WHERE id = ?').bind(id).first<WorkspaceRow>();
}

export async function upsertWorkspace(db: D1Database, row: { id: string; name: string }): Promise<void> {
  await db.prepare(`
    INSERT INTO workspaces (id, name, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP
  `).bind(row.id, row.name).run();
}

const BOT_COLUMNS = 'id, workspace_id, name, token_encrypted, token_hint, webhook_secret, public_url, support_chat_id, bind_code, bind_code_expires_at, enabled, is_default, created_at, updated_at';

export async function listBots(db: D1Database, workspace = 'default'): Promise<BotRow[]> {
  const res = await db.prepare(`SELECT ${BOT_COLUMNS} FROM bots WHERE workspace_id = ? ORDER BY is_default DESC, created_at ASC`).bind(workspace).all<BotRow>();
  return res.results ?? [];
}

export async function getBotById(db: D1Database, id: string, workspace = 'default'): Promise<BotRow | null> {
  return db.prepare(`SELECT ${BOT_COLUMNS} FROM bots WHERE workspace_id = ? AND id = ?`).bind(workspace, id).first<BotRow>();
}

export async function getBotByBindCode(db: D1Database, bindCode: string): Promise<BotRow | null> {
  return db.prepare(`SELECT ${BOT_COLUMNS} FROM bots WHERE bind_code = ? AND enabled = 1`).bind(bindCode).first<BotRow>();
}

export async function getDefaultBot(db: D1Database, workspace = 'default'): Promise<BotRow | null> {
  return db.prepare(`SELECT ${BOT_COLUMNS} FROM bots WHERE workspace_id = ? AND is_default = 1 ORDER BY created_at ASC LIMIT 1`).bind(workspace).first<BotRow>();
}

export async function getWorkspaceAdmin(db: D1Database, workspace: string, userId: string): Promise<WorkspaceAdminRow | null> {
  return db.prepare('SELECT workspace_id, user_id, name, COALESCE(role, \'admin\') AS role, created_at, updated_at FROM workspace_admins WHERE workspace_id = ? AND user_id = ?').bind(workspace, userId).first<WorkspaceAdminRow>();
}

export async function listWorkspaceAdmins(db: D1Database, workspace: string): Promise<WorkspaceAdminRow[]> {
  const res = await db.prepare('SELECT workspace_id, user_id, name, COALESCE(role, \'admin\') AS role, created_at, updated_at FROM workspace_admins WHERE workspace_id = ? ORDER BY created_at ASC').bind(workspace).all<WorkspaceAdminRow>();
  return res.results ?? [];
}

export async function upsertWorkspaceAdmin(db: D1Database, row: { workspace_id: string; user_id: string; name?: string | null; role: AdminRole }): Promise<void> {
  await db.prepare(`
    INSERT INTO workspace_admins (workspace_id, user_id, name, role, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(workspace_id, user_id) DO UPDATE SET name = excluded.name, role = excluded.role, updated_at = CURRENT_TIMESTAMP
  `).bind(row.workspace_id, row.user_id, row.name ?? null, row.role).run();
}

export async function deleteWorkspaceAdmin(db: D1Database, workspace: string, userId: string): Promise<void> {
  await db.prepare('DELETE FROM workspace_admins WHERE workspace_id = ? AND user_id = ?').bind(workspace, userId).run();
}

export async function insertDefaultBotSettings(db: D1Database, input: { tokenEncrypted?: string | null; tokenHint?: string | null; webhookSecret?: string | null; publicUrl?: string | null; supportChatId?: string | null }): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO workspaces (id, name) VALUES ('default', '默认工作区')").run();
  await db.prepare("INSERT OR IGNORE INTO bots (id, workspace_id, name, bind_code, bind_code_expires_at, enabled, is_default) VALUES ('default', 'default', '默认 Bot', NULL, NULL, 1, 1)").run();
  await db.prepare(`
    UPDATE bots SET
      token_encrypted = COALESCE(token_encrypted, ?),
      token_hint = COALESCE(token_hint, ?),
      webhook_secret = COALESCE(NULLIF(webhook_secret, ''), ?),
      public_url = COALESCE(NULLIF(public_url, ''), ?),
      support_chat_id = COALESCE(NULLIF(support_chat_id, ''), ?),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 'default'
  `).bind(input.tokenEncrypted ?? null, input.tokenHint ?? null, input.webhookSecret ?? null, input.publicUrl ?? null, input.supportChatId ?? null).run();
}

export async function upsertBot(db: D1Database, row: Omit<BotRow, 'created_at' | 'updated_at'>): Promise<void> {
  if (row.is_default) await db.prepare('UPDATE bots SET is_default = 0 WHERE workspace_id = ?').bind(row.workspace_id).run();
  await db.prepare(`
    INSERT INTO bots (id, workspace_id, name, token_encrypted, token_hint, webhook_secret, public_url, support_chat_id, bind_code, bind_code_expires_at, enabled, is_default, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      name = excluded.name,
      token_encrypted = COALESCE(excluded.token_encrypted, bots.token_encrypted),
      token_hint = COALESCE(excluded.token_hint, bots.token_hint),
      webhook_secret = excluded.webhook_secret,
      public_url = excluded.public_url,
      support_chat_id = excluded.support_chat_id,
      bind_code = excluded.bind_code,
      bind_code_expires_at = excluded.bind_code_expires_at,
      enabled = excluded.enabled,
      is_default = excluded.is_default,
      updated_at = CURRENT_TIMESTAMP
  `).bind(row.id, row.workspace_id, row.name, row.token_encrypted, row.token_hint, row.webhook_secret, row.public_url, row.support_chat_id, row.bind_code, row.bind_code_expires_at, row.enabled, row.is_default).run();
}

export async function bindBotSupportChat(db: D1Database, input: { workspaceId: string; botId: string; supportChatId: string }): Promise<void> {
  await db.prepare(`
    UPDATE bots SET support_chat_id = ?, bind_code = NULL, bind_code_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE workspace_id = ? AND id = ?
  `).bind(input.supportChatId, input.workspaceId, input.botId).run();
}

export async function deleteBot(db: D1Database, id: string, workspace = 'default'): Promise<void> {
  await db.prepare("DELETE FROM bots WHERE id != 'default' AND workspace_id = ? AND id = ?").bind(workspace, id).run();
}


export async function addAuditLog(db: D1Database, row: { actor?: string | null; ip?: string | null; action: string; target?: string | null; detail?: string | null; status?: string }): Promise<void> {
  await db
    .prepare('INSERT INTO audit_logs (actor, ip, action, target, detail, status) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(row.actor ?? null, row.ip ?? null, row.action, row.target ?? null, row.detail ?? null, row.status ?? 'ok')
    .run();
}

export async function listAuditLogs(db: D1Database, limit = 100): Promise<AuditLogRow[]> {
  const res = await db.prepare('SELECT id, actor, ip, action, target, detail, status, created_at FROM audit_logs ORDER BY id DESC LIMIT ?').bind(limit).all<AuditLogRow>();
  return res.results ?? [];
}

export async function getUserByChatId(db: D1Database, userChatId: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?')
    .bind(workspaceId(tenant as Env), botId(tenant as Env), userChatId)
    .first<UserRow>();
}

export async function findArchivedUserByChatId(db: D1Database, userChatId: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'SUPPORT_CHAT_ID'>): Promise<UserRow | null> {
  const ws = workspaceId(tenant as Env);
  const supportChatId = (tenant as Pick<Env, 'SUPPORT_CHAT_ID'> | undefined)?.SUPPORT_CHAT_ID;
  if (supportChatId) {
    const row = await db.prepare("SELECT users.* FROM users JOIN bots ON bots.workspace_id = users.workspace_id AND bots.id = users.bot_id WHERE users.workspace_id = ? AND users.user_chat_id = ? AND users.status = 'archived' AND users.topic_id IS NOT NULL AND bots.support_chat_id = ? ORDER BY users.updated_at DESC LIMIT 1")
      .bind(ws, userChatId, supportChatId)
      .first<UserRow>();
    if (row) return row;
  }
  return db.prepare("SELECT * FROM users WHERE workspace_id = ? AND user_chat_id = ? AND status = 'archived' AND topic_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1")
    .bind(ws, userChatId)
    .first<UserRow>();
}

export async function restoreArchivedUserConversation(db: D1Database, userChatId: string, row: UserRow): Promise<void> {
  await db.prepare("UPDATE users SET status = 'open', pending = 0, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?")
    .bind(row.workspace_id || 'default', row.bot_id || 'default', userChatId)
    .run();
}

export async function getUserByTopicId(db: D1Database, topicId: number, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE workspace_id = ? AND bot_id = ? AND topic_id = ?')
    .bind(workspaceId(tenant as Env), botId(tenant as Env), topicId)
    .first<UserRow>();
}

export async function upsertUser(db: D1Database, user: TelegramUser, topicId?: number | null, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db.prepare(`
    INSERT INTO users (workspace_id, bot_id, user_chat_id, topic_id, first_name, last_name, username, language_code, updated_at, last_message_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(workspace_id, bot_id, user_chat_id) DO UPDATE SET
      topic_id = COALESCE(excluded.topic_id, users.topic_id),
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      username = excluded.username,
      language_code = excluded.language_code,
      updated_at = CURRENT_TIMESTAMP,
      last_message_at = CURRENT_TIMESTAMP
  `)
    .bind(ws, bot, String(user.id), topicId ?? null, user.first_name ?? null, user.last_name ?? null, user.username ?? null, user.language_code ?? null)
    .run();
}

export async function setUserTopic(db: D1Database, userChatId: string, topicId: number | null, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  await db.prepare('UPDATE users SET topic_id = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?')
    .bind(topicId, workspaceId(tenant as Env), botId(tenant as Env), userChatId)
    .run();
}

export async function deleteUserConversation(db: D1Database, userChatId: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db.batch([
    db.prepare('DELETE FROM message_logs WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(ws, bot, userChatId),
    db.prepare('DELETE FROM message_links WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(ws, bot, userChatId),
    db.prepare('DELETE FROM blocked_users WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(ws, bot, userChatId),
    db.prepare('DELETE FROM users WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(ws, bot, userChatId),
  ]);
}

export async function archiveUserConversation(db: D1Database, userChatId: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db.batch([
    db.prepare('DELETE FROM message_logs WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(ws, bot, userChatId),
    db.prepare('DELETE FROM message_links WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(ws, bot, userChatId),
    db.prepare('DELETE FROM blocked_users WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(ws, bot, userChatId),
    db.prepare("UPDATE users SET status = 'archived', pending = 0, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?").bind(ws, bot, userChatId),
  ]);
}

export async function linkSupportMessage(
  db: D1Database,
  supportChatId: string,
  supportMessageId: number,
  userChatId: string,
  userMessageId?: number,
  tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>,
): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db.prepare(`
    INSERT OR REPLACE INTO message_links (workspace_id, bot_id, support_chat_id, support_message_id, user_chat_id, user_message_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(ws, bot, supportChatId, supportMessageId, userChatId, userMessageId ?? null)
    .run();
}

export async function getLinkedUser(db: D1Database, supportChatId: string, supportMessageId: number, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<string | null> {
  const row = await db
    .prepare('SELECT user_chat_id FROM message_links WHERE workspace_id = ? AND bot_id = ? AND support_chat_id = ? AND support_message_id = ?')
    .bind(workspaceId(tenant as Env), botId(tenant as Env), supportChatId, supportMessageId)
    .first<{ user_chat_id: string }>();
  return row?.user_chat_id ?? null;
}

export async function blockUser(db: D1Database, userChatId: string, reason?: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO blocked_users (workspace_id, bot_id, user_chat_id, reason) VALUES (?, ?, ?, ?)").bind(ws, bot, userChatId, reason ?? null),
    db.prepare('UPDATE users SET is_blocked = 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(ws, bot, userChatId),
  ]);
}

export async function unblockUser(db: D1Database, userChatId: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db.batch([
    db.prepare("DELETE FROM blocked_users WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?").bind(ws, bot, userChatId),
    db.prepare('UPDATE users SET is_blocked = 0, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(ws, bot, userChatId),
  ]);
}

export async function isBlocked(db: D1Database, userChatId: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<boolean> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  const row = await db.prepare('SELECT 1 FROM blocked_users WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(ws, bot, userChatId).first();
  if (row) return true;
  const user = await getUserByChatId(db, userChatId, tenant);
  return user?.is_blocked === 1;
}

export async function setUserNote(db: D1Database, userChatId: string, note: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db.prepare('UPDATE users SET note = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(note, ws, bot, userChatId).run();
}

export async function setUserStatus(db: D1Database, userChatId: string, status: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db
    .prepare("UPDATE users SET status = ?, closed_at = CASE WHEN ? = 'closed' THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?")
    .bind(status, status, ws, bot, userChatId)
    .run();
}

export async function setUserPending(db: D1Database, userChatId: string, pending: boolean, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db.prepare('UPDATE users SET pending = ?, status = CASE WHEN ? = 1 THEN \'pending\' ELSE \'replied\' END, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?')
    .bind(pending ? 1 : 0, pending ? 1 : 0, ws, bot, userChatId)
    .run();
}

export async function setUserAiMode(db: D1Database, userChatId: string, mode: 'manual' | 'auto', tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db.prepare('UPDATE users SET ai_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(mode, ws, bot, userChatId).run();
}

export async function setUserMuted(db: D1Database, userChatId: string, muted: boolean, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db.prepare('UPDATE users SET muted = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(muted ? 1 : 0, ws, bot, userChatId).run();
}

export async function setUserImportant(db: D1Database, userChatId: string, important: boolean, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db.prepare('UPDATE users SET important = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(important ? 1 : 0, ws, bot, userChatId).run();
}

export async function getQuickReply(db: D1Database, key: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<QuickReplyRow | null> {
  return db.prepare('SELECT key, text FROM quick_replies WHERE workspace_id = ? AND bot_id = ? AND key = ?').bind(workspaceId(tenant as Env), botId(tenant as Env), key).first<QuickReplyRow>();
}

export async function setQuickReply(db: D1Database, key: string, text: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db
    .prepare(`
      INSERT INTO quick_replies (workspace_id, bot_id, key, text, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(workspace_id, bot_id, key) DO UPDATE SET text = excluded.text, updated_at = CURRENT_TIMESTAMP
    `)
    .bind(ws, bot, key, text)
    .run();
}

export async function deleteQuickReply(db: D1Database, key: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  await db.prepare('DELETE FROM quick_replies WHERE workspace_id = ? AND bot_id = ? AND key = ?').bind(workspaceId(tenant as Env), botId(tenant as Env), key).run();
}

export async function listQuickReplies(db: D1Database, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<QuickReplyRow[]> {
  const res = await db.prepare('SELECT key, text FROM quick_replies WHERE workspace_id = ? AND bot_id = ? ORDER BY key ASC').bind(workspaceId(tenant as Env), botId(tenant as Env)).all<QuickReplyRow>();
  return res.results ?? [];
}


export async function listAiProviders(db: D1Database): Promise<AiProviderRow[]> {
  const res = await db.prepare('SELECT id, name, base_url, api_key_encrypted, api_key_hint, enabled, created_at, updated_at FROM ai_providers ORDER BY id ASC').all<AiProviderRow>();
  return res.results ?? [];
}

export async function getAiProvider(db: D1Database, id: string): Promise<AiProviderRow | null> {
  return db.prepare('SELECT id, name, base_url, api_key_encrypted, api_key_hint, enabled, created_at, updated_at FROM ai_providers WHERE id = ?').bind(id).first<AiProviderRow>();
}

export async function upsertAiProvider(db: D1Database, provider: Omit<AiProviderRow, 'created_at' | 'updated_at'>): Promise<void> {
  await db
    .prepare(`
      INSERT INTO ai_providers (id, name, base_url, api_key_encrypted, api_key_hint, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        base_url = excluded.base_url,
        api_key_encrypted = COALESCE(excluded.api_key_encrypted, ai_providers.api_key_encrypted),
        api_key_hint = COALESCE(excluded.api_key_hint, ai_providers.api_key_hint),
        enabled = excluded.enabled,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(provider.id, provider.name, provider.base_url, provider.api_key_encrypted ?? null, provider.api_key_hint ?? null, provider.enabled)
    .run();
}

export async function deleteAiProvider(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM ai_providers WHERE id != 'env-default' AND id = ?").bind(id).run();
}

export async function listAiModels(db: D1Database): Promise<AiModelRow[]> {
  const res = await db.prepare('SELECT id, provider_id, name, base_url, model, api_key_env, system_prompt, enabled, is_default, created_at, updated_at FROM ai_models ORDER BY is_default DESC, id ASC').all<AiModelRow>();
  return res.results ?? [];
}

export async function getAiModel(db: D1Database, id: string): Promise<AiModelRow | null> {
  return db.prepare('SELECT id, provider_id, name, base_url, model, api_key_env, system_prompt, enabled, is_default, created_at, updated_at FROM ai_models WHERE id = ?').bind(id).first<AiModelRow>();
}

export async function getDefaultAiModel(db: D1Database): Promise<AiModelRow | null> {
  return db.prepare('SELECT id, provider_id, name, base_url, model, api_key_env, system_prompt, enabled, is_default, created_at, updated_at FROM ai_models WHERE enabled = 1 ORDER BY is_default DESC, id ASC LIMIT 1').first<AiModelRow>();
}

export async function upsertAiModel(db: D1Database, model: Omit<AiModelRow, 'created_at' | 'updated_at'>): Promise<void> {
  if (model.is_default) await db.prepare('UPDATE ai_models SET is_default = 0').run();
  await db
    .prepare(`
      INSERT INTO ai_models (id, provider_id, name, base_url, model, api_key_env, system_prompt, enabled, is_default, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        provider_id = excluded.provider_id,
        name = excluded.name,
        base_url = excluded.base_url,
        model = excluded.model,
        api_key_env = excluded.api_key_env,
        system_prompt = excluded.system_prompt,
        enabled = excluded.enabled,
        is_default = excluded.is_default,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(model.id, model.provider_id ?? null, model.name, model.base_url, model.model, model.api_key_env, model.system_prompt ?? null, model.enabled, model.is_default)
    .run();
}

export async function setAiModelEnabled(db: D1Database, id: string, enabled: boolean): Promise<void> {
  await db.prepare('UPDATE ai_models SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(enabled ? 1 : 0, id).run();
}

export async function deleteAiModel(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM ai_models WHERE id = ? AND id != \'default\'').bind(id).run();
}

export async function setDefaultAiModel(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('UPDATE ai_models SET is_default = 0'),
    db.prepare('UPDATE ai_models SET is_default = 1, enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id),
  ]);
}

export async function getSetting(db: D1Database, key: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'> | null): Promise<string | null> {
  const ws = workspaceId(tenant as Env);
  const bot = tenant === null ? null : botId(tenant as Env);
  const row = bot
    ? await db.prepare('SELECT value FROM settings WHERE workspace_id = ? AND bot_id = ? AND key = ?').bind(ws, bot, key).first<{ value: string }>()
    : null;
  if (row) return row.value;
  const global = await db.prepare('SELECT value FROM settings WHERE workspace_id = ? AND bot_id IS NULL AND key = ?').bind(ws, key).first<{ value: string }>();
  return global?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'> | null): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = tenant === null ? null : botId(tenant as Env);
  await db
    .prepare(`
      INSERT INTO settings (workspace_id, bot_id, key, value, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(workspace_id, bot_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `)
    .bind(ws, bot, key, value)
    .run();
}

export async function logMessage(db: D1Database, userChatId: string, direction: 'in' | 'out', messageId: number, text?: string | null, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>, media?: { media_type?: string | null; file_id?: string | null; file_name?: string | null; mime_type?: string | null; duration?: number | null }): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db
    .prepare('INSERT INTO message_logs (workspace_id, bot_id, user_chat_id, direction, message_id, text, media_type, file_id, file_name, mime_type, duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(ws, bot, userChatId, direction, messageId, text ?? null, media?.media_type ?? null, media?.file_id ?? null, media?.file_name ?? null, media?.mime_type ?? null, media?.duration ?? null)
    .run();
  await db
    .prepare('UPDATE users SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?')
    .bind(ws, bot, userChatId)
    .run();
}

export async function getRecentLogs(db: D1Database, userChatId: string, limit = 8, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<MessageLogRow[]> {
  const res = await db
    .prepare('SELECT id, direction, text, created_at, message_id, media_type, file_id, file_name, mime_type, duration FROM message_logs WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ? ORDER BY id DESC LIMIT ?')
    .bind(workspaceId(tenant as Env), botId(tenant as Env), userChatId, limit)
    .all<MessageLogRow>();
  return res.results ?? [];
}

export async function getMessageLogMedia(db: D1Database, id: number, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<(Pick<MessageLogRow, 'id' | 'media_type' | 'file_id' | 'file_name' | 'mime_type'> & { workspace_id?: string; bot_id?: string }) | null> {
  const scoped = await db
    .prepare('SELECT id, workspace_id, bot_id, media_type, file_id, file_name, mime_type FROM message_logs WHERE workspace_id = ? AND bot_id = ? AND id = ?')
    .bind(workspaceId(tenant as Env), botId(tenant as Env), id)
    .first<Pick<MessageLogRow, 'id' | 'media_type' | 'file_id' | 'file_name' | 'mime_type'> & { workspace_id?: string; bot_id?: string }>();
  if (scoped) return scoped;
  return db
    .prepare('SELECT id, workspace_id, bot_id, media_type, file_id, file_name, mime_type FROM message_logs WHERE id = ?')
    .bind(id)
    .first<Pick<MessageLogRow, 'id' | 'media_type' | 'file_id' | 'file_name' | 'mime_type'> & { workspace_id?: string; bot_id?: string }>();
}

export interface UserInteractionStatsRow {
  total_messages: number;
  inbound_messages: number;
  outbound_messages: number;
  messages_7d: number;
  first_message_at: string | null;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
}

export interface WorkbenchStatsRow {
  today_users: number;
  today_new_users: number;
  today_inbound_messages: number;
  today_outbound_messages: number;
  week_users: number;
  week_messages: number;
  week_new_users: number;
}

export async function getWorkbenchStatsRow(db: D1Database, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<WorkbenchStatsRow> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  const row = await db.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN ml.created_at >= date('now') THEN ml.user_chat_id END) AS today_users,
      (SELECT COUNT(*) FROM users u WHERE u.workspace_id = ? AND u.bot_id = ? AND u.created_at >= date('now')) AS today_new_users,
      SUM(CASE WHEN ml.direction = 'in' AND ml.created_at >= date('now') THEN 1 ELSE 0 END) AS today_inbound_messages,
      SUM(CASE WHEN ml.direction = 'out' AND ml.created_at >= date('now') THEN 1 ELSE 0 END) AS today_outbound_messages,
      COUNT(DISTINCT CASE WHEN ml.created_at >= datetime('now', '-7 days') THEN ml.user_chat_id END) AS week_users,
      SUM(CASE WHEN ml.created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS week_messages,
      (SELECT COUNT(*) FROM users u WHERE u.workspace_id = ? AND u.bot_id = ? AND u.created_at >= datetime('now', '-7 days')) AS week_new_users
    FROM message_logs ml
    WHERE ml.workspace_id = ? AND ml.bot_id = ?
  `).bind(ws, bot, ws, bot, ws, bot).first<WorkbenchStatsRow>();
  return row ?? { today_users: 0, today_new_users: 0, today_inbound_messages: 0, today_outbound_messages: 0, week_users: 0, week_messages: 0, week_new_users: 0 };
}

export async function getUserInteractionStats(db: D1Database, userChatId: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<UserInteractionStatsRow> {
  const row = await db
    .prepare(`
      SELECT
        COUNT(*) AS total_messages,
        SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END) AS inbound_messages,
        SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) AS outbound_messages,
        SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS messages_7d,
        MIN(created_at) AS first_message_at,
        MAX(created_at) AS last_message_at,
        MAX(CASE WHEN direction = 'in' THEN created_at END) AS last_inbound_at,
        MAX(CASE WHEN direction = 'out' THEN created_at END) AS last_outbound_at
      FROM message_logs
      WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?
    `)
    .bind(workspaceId(tenant as Env), botId(tenant as Env), userChatId)
    .first<UserInteractionStatsRow>();
  return row ?? { total_messages: 0, inbound_messages: 0, outbound_messages: 0, messages_7d: 0, first_message_at: null, last_message_at: null, last_inbound_at: null, last_outbound_at: null };
}

export async function setUserTags(db: D1Database, userChatId: string, tags: string[], tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  await db.prepare('UPDATE users SET tags = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND user_chat_id = ?').bind(tags.join(','), workspaceId(tenant as Env), botId(tenant as Env), userChatId).run();
}

export async function addUserTag(db: D1Database, userChatId: string, tag: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<string[]> {
  const row = await getUserByChatId(db, userChatId, tenant);
  const tags = new Set((row?.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  tags.add(tag);
  const next = [...tags];
  await setUserTags(db, userChatId, next, tenant);
  return next;
}

export async function removeUserTag(db: D1Database, userChatId: string, tag: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<string[]> {
  const row = await getUserByChatId(db, userChatId, tenant);
  const next = (row?.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean).filter((x) => x !== tag);
  await setUserTags(db, userChatId, next, tenant);
  return next;
}

export async function listKeywordReplies(db: D1Database, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<KeywordReplyRow[]> {
  const res = await db.prepare('SELECT keyword, reply, match_mode, enabled FROM keyword_replies WHERE workspace_id = ? AND bot_id = ? ORDER BY keyword ASC').bind(workspaceId(tenant as Env), botId(tenant as Env)).all<KeywordReplyRow>();
  return res.results ?? [];
}

export async function setKeywordReply(db: D1Database, keyword: string, reply: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  await db
    .prepare(`
      INSERT INTO keyword_replies (workspace_id, bot_id, keyword, reply, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(workspace_id, bot_id, keyword) DO UPDATE SET reply = excluded.reply, enabled = 1, updated_at = CURRENT_TIMESTAMP
    `)
    .bind(ws, bot, keyword, reply)
    .run();
}

export async function setKeywordEnabled(db: D1Database, keyword: string, enabled: boolean, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  await db.prepare('UPDATE keyword_replies SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND bot_id = ? AND keyword = ?').bind(enabled ? 1 : 0, workspaceId(tenant as Env), botId(tenant as Env), keyword).run();
}

export async function deleteKeywordReply(db: D1Database, keyword: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  await db.prepare('DELETE FROM keyword_replies WHERE workspace_id = ? AND bot_id = ? AND keyword = ?').bind(workspaceId(tenant as Env), botId(tenant as Env), keyword).run();
}

export async function findKeywordReply(db: D1Database, text: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<KeywordReplyRow | null> {
  const rows = await listKeywordReplies(db, tenant);
  const lower = text.toLowerCase();
  return rows.find((row) => row.enabled && lower.includes(row.keyword.toLowerCase())) ?? null;
}

export async function addAdmin(db: D1Database, userId: string, name?: string, role: AdminRole = 'admin'): Promise<void> {
  await db.prepare("INSERT OR REPLACE INTO admins (workspace_id, user_id, name, role) VALUES ('default', ?, ?, ?)").bind(userId, name ?? null, role).run();
}

export async function removeAdmin(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM admins WHERE workspace_id = 'default' AND user_id = ?").bind(userId).run();
}

export async function listAdmins(db: D1Database): Promise<AdminRow[]> {
  const res = await db.prepare("SELECT user_id, name, COALESCE(role, 'admin') AS role, created_at FROM admins WHERE workspace_id = 'default' ORDER BY created_at ASC").all<AdminRow>();
  return res.results ?? [];
}

export async function getDbAdmin(db: D1Database, userId: string): Promise<AdminRow | null> {
  return db.prepare("SELECT user_id, name, COALESCE(role, 'admin') AS role, created_at FROM admins WHERE workspace_id = 'default' AND user_id = ?").bind(userId).first<AdminRow>();
}

export async function isDbAdmin(db: D1Database, userId: string): Promise<boolean> {
  return Boolean(await getDbAdmin(db, userId));
}

export async function listUsers(db: D1Database, filter?: string, limit = 20, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<UserRow[]> {
  const pattern = filter ? `%${filter}%` : null;
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  const sql = filter
    ? "SELECT * FROM users WHERE workspace_id = ? AND bot_id = ? AND COALESCE(status, 'open') != 'archived' AND (tags LIKE ? OR username LIKE ? OR first_name LIKE ? OR last_name LIKE ?) ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT ?"
    : "SELECT * FROM users WHERE workspace_id = ? AND bot_id = ? AND COALESCE(status, 'open') != 'archived' ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT ?";
  const stmt = filter ? db.prepare(sql).bind(ws, bot, pattern, pattern, pattern, pattern, limit) : db.prepare(sql).bind(ws, bot, limit);
  const res = await stmt.all<UserRow>();
  return res.results ?? [];
}

export async function listPendingUsers(db: D1Database, limit = 20, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<UserRow[]> {
  const res = await db.prepare("SELECT * FROM users WHERE workspace_id = ? AND bot_id = ? AND COALESCE(status, 'open') != 'archived' AND (pending = 1 OR status = 'pending') ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT ?").bind(workspaceId(tenant as Env), botId(tenant as Env), limit).all<UserRow>();
  return res.results ?? [];
}

export async function getUsersOlderThan(db: D1Database, days: number, limit = 1000, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<UserRow[]> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  if (days <= 0) {
    const res = await db.prepare("SELECT * FROM users WHERE workspace_id = ? AND bot_id = ? AND COALESCE(status, 'open') != 'archived' ORDER BY COALESCE(last_message_at, updated_at, created_at) ASC LIMIT ?").bind(ws, bot, limit).all<UserRow>();
    return res.results ?? [];
  }
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const res = await db.prepare("SELECT * FROM users WHERE workspace_id = ? AND bot_id = ? AND COALESCE(status, 'open') != 'archived' AND COALESCE(last_message_at, updated_at, created_at) < ? ORDER BY COALESCE(last_message_at, updated_at, created_at) ASC LIMIT ?").bind(ws, bot, cutoff, limit).all<UserRow>();
  return res.results ?? [];
}

export async function listBroadcastTargets(db: D1Database, limit = 1000, filter: string | null = null, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<UserRow[]> {
  const ws = workspaceId(tenant as Env);
  const bot = botId(tenant as Env);
  const parsed = parseBroadcastFilter(filter);
  if (parsed.type === 'tag' && parsed.value) {
    const pattern = `%${parsed.value}%`;
    const res = await db
      .prepare("SELECT * FROM users WHERE workspace_id = ? AND bot_id = ? AND is_blocked = 0 AND tags LIKE ? ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT ?")
      .bind(ws, bot, pattern, limit)
      .all<UserRow>();
    return res.results ?? [];
  }
  if (parsed.type === 'pending') {
    const res = await db
      .prepare("SELECT * FROM users WHERE workspace_id = ? AND bot_id = ? AND is_blocked = 0 AND (pending = 1 OR status = 'pending') ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT ?")
      .bind(ws, bot, limit)
      .all<UserRow>();
    return res.results ?? [];
  }
  if (parsed.type === 'important') {
    const res = await db
      .prepare("SELECT * FROM users WHERE workspace_id = ? AND bot_id = ? AND is_blocked = 0 AND important = 1 ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT ?")
      .bind(ws, bot, limit)
      .all<UserRow>();
    return res.results ?? [];
  }
  if (parsed.type === 'active_days' && parsed.value) {
    const days = Math.max(1, Math.min(365, Number(parsed.value) || 7));
    const res = await db
      .prepare("SELECT * FROM users WHERE workspace_id = ? AND bot_id = ? AND is_blocked = 0 AND last_message_at >= datetime('now', ?) ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT ?")
      .bind(ws, bot, `-${days} days`, limit)
      .all<UserRow>();
    return res.results ?? [];
  }
  const res = await db.prepare('SELECT * FROM users WHERE workspace_id = ? AND bot_id = ? AND is_blocked = 0 ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT ?').bind(ws, bot, limit).all<UserRow>();
  return res.results ?? [];
}

export async function saveBroadcast(db: D1Database, id: string, text: string, createdBy?: string, targetFilter?: string | null, targetCount?: number, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  await db
    .prepare("INSERT OR REPLACE INTO broadcasts (workspace_id, bot_id, id, text, created_by, status, target_filter, target_count) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)")
    .bind(workspaceId(tenant as Env), botId(tenant as Env), id, text, createdBy ?? null, targetFilter ?? null, targetCount ?? null)
    .run();
}

export async function getBroadcast(db: D1Database, id: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<BroadcastRow | null> {
  return db.prepare('SELECT id, text, created_by, status, created_at, target_filter, target_count, ok_count, failed_count FROM broadcasts WHERE workspace_id = ? AND bot_id = ? AND id = ?').bind(workspaceId(tenant as Env), botId(tenant as Env), id).first<BroadcastRow>();
}

export async function listBroadcasts(db: D1Database, limit = 20, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<BroadcastRow[]> {
  const res = await db.prepare('SELECT id, text, created_by, status, created_at, sent_at, target_filter, target_count, ok_count, failed_count FROM broadcasts WHERE workspace_id = ? AND bot_id = ? ORDER BY created_at DESC LIMIT ?').bind(workspaceId(tenant as Env), botId(tenant as Env), limit).all<BroadcastRow>();
  return res.results ?? [];
}

export async function markBroadcastSent(db: D1Database, id: string, okCount = 0, failedCount = 0, targetCount = 0, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  await db.prepare("UPDATE broadcasts SET status = 'sent', sent_at = CURRENT_TIMESTAMP, ok_count = ?, failed_count = ?, target_count = ? WHERE workspace_id = ? AND bot_id = ? AND id = ?").bind(okCount, failedCount, targetCount, workspaceId(tenant as Env), botId(tenant as Env), id).run();
}

export async function saveBroadcastResult(db: D1Database, broadcastId: string, userChatId: string, status: 'ok' | 'failed', error?: string | null, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO broadcast_results (workspace_id, bot_id, broadcast_id, user_chat_id, status, error, sent_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
    .bind(workspaceId(tenant as Env), botId(tenant as Env), broadcastId, userChatId, status, error ?? null)
    .run();
}

export async function listBroadcastResults(db: D1Database, broadcastId: string, limit = 500, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<BroadcastResultRow[]> {
  const res = await db
    .prepare('SELECT broadcast_id, user_chat_id, status, error, sent_at FROM broadcast_results WHERE workspace_id = ? AND bot_id = ? AND broadcast_id = ? ORDER BY sent_at DESC LIMIT ?')
    .bind(workspaceId(tenant as Env), botId(tenant as Env), broadcastId, limit)
    .all<BroadcastResultRow>();
  return res.results ?? [];
}

function parseBroadcastFilter(filter: string | null): { type: string; value?: string } {
  if (!filter || filter === 'all') return { type: 'all' };
  const [type, ...rest] = filter.split(':');
  return { type, value: rest.join(':') || undefined };
}


export async function createKbImportBatch(db: D1Database, id: string, source: string, title: string | null, importedCount: number): Promise<void> {
  await db.prepare('INSERT INTO kb_import_batches (id, source, title, imported_count) VALUES (?, ?, ?, ?)').bind(id, source, title, importedCount).run();
}

export async function insertKbRawMessage(db: D1Database, row: Omit<KbRawMessageRow, 'id' | 'created_at'>): Promise<void> {
  await db
    .prepare('INSERT INTO kb_raw_messages (batch_id, source, chat_title, message_id, sender_name, message_date, text, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.batch_id, row.source, row.chat_title, row.message_id, row.sender_name, row.message_date, row.text, row.tags)
    .run();
}

export async function listKbRawMessages(db: D1Database, q?: string, limit = 100): Promise<KbRawMessageRow[]> {
  const pattern = q ? `%${q}%` : null;
  const stmt = q
    ? db.prepare('SELECT * FROM kb_raw_messages WHERE text LIKE ? OR sender_name LIKE ? OR tags LIKE ? ORDER BY id DESC LIMIT ?').bind(pattern, pattern, pattern, limit)
    : db.prepare('SELECT * FROM kb_raw_messages ORDER BY id DESC LIMIT ?').bind(limit);
  const res = await stmt.all<KbRawMessageRow>();
  return res.results ?? [];
}

export async function listKbEntries(db: D1Database, q?: string, limit = 100, enabledOnly = false): Promise<KbEntryRow[]> {
  const pattern = q ? `%${q}%` : null;
  const where = [enabledOnly ? 'enabled = 1' : '', q ? '(title LIKE ? OR content LIKE ? OR tags LIKE ?)' : ''].filter(Boolean).join(' AND ');
  const sql = `SELECT * FROM kb_entries ${where ? `WHERE ${where}` : ''} ORDER BY updated_at DESC LIMIT ?`;
  const stmt = q ? db.prepare(sql).bind(pattern, pattern, pattern, limit) : db.prepare(sql).bind(limit);
  const res = await stmt.all<KbEntryRow>();
  return res.results ?? [];
}

export async function upsertKbEntry(db: D1Database, row: Omit<KbEntryRow, 'created_at' | 'updated_at'>): Promise<void> {
  await db
    .prepare(`
      INSERT INTO kb_entries (id, title, content, tags, source, confidence, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, tags = excluded.tags, source = excluded.source, confidence = excluded.confidence, enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP
    `)
    .bind(row.id, row.title, row.content, row.tags, row.source, row.confidence, row.enabled)
    .run();
}

export async function deleteKbEntry(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM kb_entries WHERE id = ?').bind(id).run();
}

export async function findKnowledgeEntries(db: D1Database, text: string, limit = 5): Promise<KbEntryRow[]> {
  const tokens = text.split(/\s+|[，。！？,.!?;；:：、]/).map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 8);
  const all = await listKbEntries(db, undefined, 200, true);
  return all
    .map((row) => ({ row, score: tokens.reduce((n, token) => n + (`${row.title}\n${row.content}\n${row.tags ?? ''}`.includes(token) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.row);
}

export async function listSensitiveWords(db: D1Database, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<Array<{ word: string; created_at: string }>> {
  const res = await db.prepare('SELECT word, created_at FROM sensitive_words WHERE workspace_id = ? AND bot_id = ? ORDER BY word ASC').bind(workspaceId(tenant as Env), botId(tenant as Env)).all<{ word: string; created_at: string }>();
  return res.results ?? [];
}

export async function addSensitiveWord(db: D1Database, word: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO sensitive_words (workspace_id, bot_id, word) VALUES (?, ?, ?)').bind(workspaceId(tenant as Env), botId(tenant as Env), word).run();
}

export async function deleteSensitiveWord(db: D1Database, word: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<void> {
  await db.prepare('DELETE FROM sensitive_words WHERE workspace_id = ? AND bot_id = ? AND word = ?').bind(workspaceId(tenant as Env), botId(tenant as Env), word).run();
}

export async function findSensitiveWord(db: D1Database, text: string, tenant?: Pick<Env, 'WORKSPACE_ID' | 'BOT_ID'>): Promise<string | null> {
  const res = await db.prepare('SELECT word FROM sensitive_words WHERE workspace_id = ? AND bot_id = ?').bind(workspaceId(tenant as Env), botId(tenant as Env)).all<{ word: string }>();
  const lower = text.toLowerCase();
  return (res.results ?? []).find((x) => lower.includes(x.word.toLowerCase()))?.word ?? null;
}
