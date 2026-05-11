import {
  addUserTag,
  blockUser,
  archiveUserConversation,
  deleteUserConversation,
  getRecentLogs,
  getSetting,
  getUsersOlderThan,
  getUserByChatId,
  getUserInteractionStats,
  listKeywordReplies,
  listPendingUsers,
  listQuickReplies,
  listUsers,
  removeUserTag,
  setUserAiMode,
  setUserImportant,
  setUserMuted,
  setUserNote,
  setUserPending,
  setUserStatus,
  unblockUser,
} from '../db';
import { closeForumTopic, deleteForumTopic, editForumTopic, sendMessage } from '../telegram';
import type { Env, UserRow } from '../types';

export type UserAction =
  | 'note'
  | 'tag_add'
  | 'tag_remove'
  | 'block'
  | 'unblock'
  | 'close'
  | 'open'
  | 'mute'
  | 'unmute'
  | 'pin'
  | 'unpin'
  | 'ai_on'
  | 'ai_off'
  | 'mark_replied'
  | 'mark_pending';

export async function getDashboard(env: Env, q?: string) {
  const [users, pending, quick, keywords] = await Promise.all([
    listUsers(env.DB, q, 50, env),
    listPendingUsers(env.DB, 50, env),
    listQuickReplies(env.DB, env),
    listKeywordReplies(env.DB, env),
  ]);
  return { users, pending, quick, keywords };
}

export async function getUserDetail(env: Env, userId: string) {
  const [user, logs] = await Promise.all([
    getUserByChatId(env.DB, userId, env),
    getRecentLogs(env.DB, userId, 30, env),
  ]);
  return { user, logs };
}

export async function removeUserConversation(env: Env, userId: string, options: { notifyTelegram?: boolean } = {}): Promise<{ deleted: number }> {
  if (!userId) throw new Error('user_id is required');
  const row = await getUserByChatId(env.DB, userId, env);
  if (!row) return { deleted: 0 };
  const mode = await conversationDeleteMode(env);
  await notifyConversationDeleted(env, [row], options.notifyTelegram ?? true, mode);
  if (mode === 'close') await archiveUserConversation(env.DB, userId, env);
  else await deleteUserConversation(env.DB, userId, env);
  return { deleted: 1 };
}

export async function removeUserConversations(env: Env, input: { userIds?: string[]; olderThanDays?: number; all?: boolean; notifyTelegram?: boolean }): Promise<{ deleted: number }> {
  const explicitIds = [...new Set((input.userIds ?? []).map((x) => x.trim()).filter(Boolean))];
  const rows: UserRow[] = [];
  if (explicitIds.length) {
    for (const id of explicitIds) {
      const row = await getUserByChatId(env.DB, id, env);
      if (row) rows.push(row);
    }
  } else if (input.all || input.olderThanDays) {
    rows.push(...await getUsersOlderThan(env.DB, input.olderThanDays || 0, input.all ? 10000 : 1000, env));
  }
  const uniqueRows = [...new Map(rows.map((row) => [row.user_chat_id, row])).values()];
  if (!uniqueRows.length) return { deleted: 0 };
  const mode = await conversationDeleteMode(env);
  await notifyConversationDeleted(env, uniqueRows, input.notifyTelegram ?? true, mode);
  for (const row of uniqueRows) {
    if (mode === 'close') await archiveUserConversation(env.DB, row.user_chat_id, env);
    else await deleteUserConversation(env.DB, row.user_chat_id, env);
  }
  return { deleted: uniqueRows.length };
}

async function conversationDeleteMode(env: Env): Promise<string> {
  return ((await getSetting(env.DB, 'support_topic_delete_mode', env)) || 'close').trim();
}

async function notifyConversationDeleted(env: Env, rows: UserRow[], enabled: boolean, mode: string): Promise<void> {
  if (!enabled || !env.SUPPORT_CHAT_ID) return;
  for (const row of rows) {
    if (!row.topic_id) continue;
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.username || row.user_chat_id;
    try {
      await sendMessage(env, env.SUPPORT_CHAT_ID, `🗑️ 后台已删除这个会话：${name}（ID: <code>${row.user_chat_id}</code>）。\n\n这个 Topic 不再绑定客户，继续在这里回复不会转发。若客户再次私聊 Bot，系统会重新创建/绑定会话。`, { message_thread_id: row.topic_id });
      await editForumTopic(env, env.SUPPORT_CHAT_ID, row.topic_id, `🗑️ 已删除 ${name}`.slice(0, 128));
      if (mode === 'delete') await deleteForumTopic(env, env.SUPPORT_CHAT_ID, row.topic_id);
      else if (mode !== 'notify') await closeForumTopic(env, env.SUPPORT_CHAT_ID, row.topic_id);
    } catch (err) {
      console.warn('cleanup deleted conversation topic failed', err);
    }
  }
}

export async function getUserStats(env: Env, userId: string) {
  const [user, stats] = await Promise.all([
    getUserByChatId(env.DB, userId, env),
    getUserInteractionStats(env.DB, userId, env),
  ]);
  if (!user) throw new Error('user not found');
  const waitingSince = user.pending && stats.last_inbound_at && (!stats.last_outbound_at || stats.last_inbound_at > stats.last_outbound_at)
    ? stats.last_inbound_at
    : null;
  return {
    user,
    stats: {
      ...stats,
      total_messages: Number(stats.total_messages || 0),
      inbound_messages: Number(stats.inbound_messages || 0),
      outbound_messages: Number(stats.outbound_messages || 0),
      messages_7d: Number(stats.messages_7d || 0),
      waiting_since: waitingSince,
      waiting_seconds: waitingSince ? Math.max(0, Math.floor((Date.now() - Date.parse(`${waitingSince.replace(' ', 'T')}Z`)) / 1000)) : 0,
    },
  };
}

export async function applyUserAction(env: Env, userId: string, action: UserAction, value?: string): Promise<void> {
  if (!userId) throw new Error('user_id is required');

  if (action === 'note') return setUserNote(env.DB, userId, value ?? '', env);
  if (action === 'tag_add') {
    const tag = (value ?? '').trim();
    if (!tag) throw new Error('tag is required');
    await addUserTag(env.DB, userId, tag, env);
    return;
  }
  if (action === 'tag_remove') {
    const tag = (value ?? '').trim();
    if (!tag) throw new Error('tag is required');
    await removeUserTag(env.DB, userId, tag, env);
    return;
  }
  if (action === 'block') return blockUser(env.DB, userId, value || undefined, env);
  if (action === 'unblock') return unblockUser(env.DB, userId, env);
  if (action === 'close') return setUserStatus(env.DB, userId, 'closed', env);
  if (action === 'open') return setUserStatus(env.DB, userId, 'open', env);
  if (action === 'mute') return setUserMuted(env.DB, userId, true, env);
  if (action === 'unmute') return setUserMuted(env.DB, userId, false, env);
  if (action === 'pin') return setUserImportant(env.DB, userId, true, env);
  if (action === 'unpin') return setUserImportant(env.DB, userId, false, env);
  if (action === 'ai_on') return setUserAiMode(env.DB, userId, 'auto', env);
  if (action === 'ai_off') return setUserAiMode(env.DB, userId, 'manual', env);
  if (action === 'mark_replied') return setUserPending(env.DB, userId, false, env);
  if (action === 'mark_pending') return setUserPending(env.DB, userId, true, env);

  throw new Error(`Unsupported user action: ${action}`);
}
