import { getSetting, setSetting } from './db';
import { editForumTopic, html, sendMessage } from './telegram';
import { workbenchKeyboard } from './support-workbench';
import type { Env, TelegramMessage, UserRow } from './types';

const WORKBENCH_MESSAGE_ID = 'support_workbench_message_id';

export function supportTopicTitle(row: UserRow): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.username || row.user_chat_id;
  const prefix = row.is_blocked
    ? '⛔'
    : row.status === 'closed'
      ? '🔒'
      : row.important
        ? '⭐'
        : row.pending
          ? '🕘'
          : '✅';
  const suffix = row.username ? ` @${row.username}` : ` ${row.user_chat_id}`;
  return `${prefix} ${name}${suffix}`.slice(0, 128);
}

export async function syncSupportTopicTitle(env: Env, row: UserRow): Promise<void> {
  if (!env.SUPPORT_CHAT_ID || !row.topic_id) return;
  try {
    await editForumTopic(env, env.SUPPORT_CHAT_ID, row.topic_id, supportTopicTitle(row));
  } catch (err) {
    console.warn('edit forum topic failed', err);
  }
}

export async function sendOrRefreshWorkbench(env: Env, message: TelegramMessage | null, text: string): Promise<void> {
  if (!env.SUPPORT_CHAT_ID) return;
  const savedMessageId = await getSetting(env.DB, WORKBENCH_MESSAGE_ID, env);
  const extra = { reply_markup: workbenchKeyboard() };

  if (savedMessageId && /^\d+$/.test(savedMessageId)) {
    try {
      const { editMessageText } = await import('./telegram');
      await editMessageText(env, env.SUPPORT_CHAT_ID, Number(savedMessageId), text, extra);
      return;
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (text.includes('message is not modified')) return;
      console.warn('refresh saved workbench failed, sending a new one', err);
    }
  }

  const sent = await sendMessage(env, env.SUPPORT_CHAT_ID, text, {
    ...(message?.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
    ...extra,
  });
  await setSetting(env.DB, WORKBENCH_MESSAGE_ID, String(sent.message_id), env);
}

export async function updateWorkbenchAfterChange(env: Env, summaryText: string): Promise<void> {
  const savedMessageId = await getSetting(env.DB, WORKBENCH_MESSAGE_ID, env);
  if (!savedMessageId || !/^\d+$/.test(savedMessageId) || !env.SUPPORT_CHAT_ID) return;
  try {
    const { editMessageText } = await import('./telegram');
    await editMessageText(env, env.SUPPORT_CHAT_ID, Number(savedMessageId), summaryText, { reply_markup: workbenchKeyboard() });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (!text.includes('message is not modified')) console.warn('update workbench failed', err);
  }
}

export function topicRecoveryNotice(row: UserRow): string {
  return `♻️ 检测到旧 Topic 已不存在，已自动重建。\n用户：<code>${html(row.user_chat_id)}</code>`;
}
