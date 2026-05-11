import {
  addAdmin,
  getSetting,
  listAdmins,
  listAiModels,
  listAiProviders,
  listSensitiveWords,
  removeAdmin,
  setKeywordReply,
  setQuickReply,
  setSetting,
} from '../db';
import { isAdminRole } from '../admin-permissions';
import type { AdminRole, AdminSession, Env } from '../types';

export const SETTINGS_KEYS = [
  'welcome_message',
  'closed_message',
  'rate_limit_count',
  'rate_limit_window_seconds',
  'ai_auto_reply',
  'ai_base_url',
  'ai_model',
  'ai_system_prompt',
  'broadcast_confirm_ttl_seconds',
  'support_chat_id',
  'pending_tracking_enabled',
  'support_message_panel_enabled',
  'support_topic_delete_mode',
  'support_notification_mode',
  'support_digest_thread_id',
] as const;

export async function getSettingsPanel(env: Env) {
  const entries = await Promise.all(SETTINGS_KEYS.map(async (key) => [key, await getSetting(env.DB, key, env)] as const));
  const settings = Object.fromEntries(entries);
  const [admins, sensitiveWords, aiModels, aiProviders] = await Promise.all([listAdmins(env.DB), listSensitiveWords(env.DB, env), listAiModels(env.DB), listAiProviders(env.DB)]);
  return { settings, admins, sensitiveWords, aiModels, aiProviders };
}

export async function getAdminsPanel(env: Env, session?: AdminSession) {
  const admins = await listAdmins(env.DB);
  return {
    admins,
    session: session ? {
      actor: session.actor,
      role: session.role,
      isOwner: session.isOwner,
      canWrite: session.canWrite,
      canManageAdmins: session.role === 'owner',
    } : undefined,
  };
}

export async function runSetupWizard(env: Env, preset: string): Promise<void> {
  if (preset !== 'basic') throw new Error('unsupported setup preset');
  await setSetting(env.DB, 'welcome_message', '你好，消息已收到。请直接说明你的问题，我看到后会尽快回复。', env);
  await setSetting(env.DB, 'closed_message', '这个会话已重新打开，请继续发送你的问题。', env);
  await setSetting(env.DB, 'rate_limit_count', '8', env);
  await setSetting(env.DB, 'rate_limit_window_seconds', '60', env);
  await setSetting(env.DB, 'ai_auto_reply', 'false', env);
  await setQuickReply(env.DB, 'hello', '你好，消息已收到，请直接说明你的问题。', env);
  await setQuickReply(env.DB, 'busy', '消息已收到，我现在不一定能马上回复，稍后看到会处理。', env);
  await setQuickReply(env.DB, 'done', '这边已经处理好了，你再确认一下。', env);
  await setKeywordReply(env.DB, '价格', '你好，关于价格请直接说明你需要的服务/套餐，我看到后会给你具体报价。', env);
  await setKeywordReply(env.DB, '付款', '付款前请先确认订单内容，避免转错或备注错误。', env);
}

export async function updateSetting(env: Env, key: string, value: string): Promise<void> {
  key = key.trim();
  value = value.trim();
  if (!SETTINGS_KEYS.includes(key as (typeof SETTINGS_KEYS)[number]) && !key.startsWith('pending_welcome:')) throw new Error('unsupported setting key');
  if (['rate_limit_count', 'rate_limit_window_seconds', 'broadcast_confirm_ttl_seconds'].includes(key)) {
    const num = Number(value);
    if (!Number.isInteger(num) || num < 1) throw new Error(`${key} must be a positive integer`);
  }
  if (['ai_auto_reply', 'pending_tracking_enabled', 'support_message_panel_enabled'].includes(key) && !['true', 'false'].includes(value)) throw new Error(`${key} must be true or false`);
  if (key === 'support_topic_delete_mode' && !['notify', 'close', 'delete'].includes(value)) throw new Error('support_topic_delete_mode must be notify/close/delete');
  if (key === 'support_notification_mode' && !['off', 'digest'].includes(value)) throw new Error('support_notification_mode must be off/digest');
  if (key === 'support_digest_thread_id' && value && !/^\d+$/.test(value)) throw new Error('support_digest_thread_id must be a topic/thread id number');
  if (key === 'support_chat_id' && value && !/^-100\d+/.test(value)) throw new Error('support_chat_id 应为 -100 开头的后台 Forum 群 ID');
  await setSetting(env.DB, key, value, env);
}

export async function saveAdmin(env: Env, userId: string, name?: string, role: AdminRole | string = 'admin'): Promise<void> {
  userId = userId.trim();
  if (!/^\d+$/.test(userId)) throw new Error('admin Telegram user id is required');
  if (!isAdminRole(role)) throw new Error('unsupported admin role');
  await addAdmin(env.DB, userId, name?.trim() || undefined, role);
}

export async function removeAdminUser(env: Env, userId: string): Promise<void> {
  userId = userId.trim();
  if (!/^\d+$/.test(userId)) throw new Error('admin Telegram user id is required');
  await removeAdmin(env.DB, userId);
}
