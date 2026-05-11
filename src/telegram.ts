import type { Env, TelegramMessage, TgResponse } from './types';

export class TelegramError extends Error {
  constructor(message: string, public readonly payload?: unknown) {
    super(message);
  }
}

export async function tg<T = unknown>(env: Env, method: string, body: Record<string, unknown>): Promise<T> {
  const base = (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new TelegramError(`${method} network failed: ${describeFetchError(err)}`, err);
  }
  const data = (await res.json()) as TgResponse<T>;
  if (!data.ok) {
    throw new TelegramError(`${method} failed: ${data.description ?? res.statusText}`, data);
  }
  return data.result as T;
}

export async function sendMessage(env: Env, chatId: string | number, text: string, extra: Record<string, unknown> = {}) {
  return tg<TelegramMessage>(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

export async function answerCallbackQuery(env: Env, callbackQueryId: string, text?: string, extra: Record<string, unknown> = {}) {
  return tg(env, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
    ...extra,
  });
}

export async function editMessageText(
  env: Env,
  chatId: string | number,
  messageId: number,
  text: string,
  extra: Record<string, unknown> = {},
) {
  return tg<TelegramMessage>(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

export async function deleteMessage(env: Env, chatId: string | number, messageId: number) {
  return tg(env, 'deleteMessage', {
    chat_id: chatId,
    message_id: messageId,
  });
}

export async function copyMessage(
  env: Env,
  toChatId: string | number,
  fromChatId: string | number,
  messageId: number,
  extra: Record<string, unknown> = {},
) {
  return tg<TelegramMessage>(env, 'copyMessage', {
    chat_id: toChatId,
    from_chat_id: fromChatId,
    message_id: messageId,
    ...extra,
  });
}

export async function createForumTopic(env: Env, chatId: string | number, name: string) {
  return tg<{ message_thread_id: number; name: string }>(env, 'createForumTopic', {
    chat_id: chatId,
    name: name.slice(0, 128),
  });
}

export async function editForumTopic(env: Env, chatId: string | number, messageThreadId: number, name: string) {
  return tg(env, 'editForumTopic', {
    chat_id: chatId,
    message_thread_id: messageThreadId,
    name: name.slice(0, 128),
  });
}

export async function closeForumTopic(env: Env, chatId: string | number, messageThreadId: number) {
  return tg(env, 'closeForumTopic', {
    chat_id: chatId,
    message_thread_id: messageThreadId,
  });
}

export async function deleteForumTopic(env: Env, chatId: string | number, messageThreadId: number) {
  return tg(env, 'deleteForumTopic', {
    chat_id: chatId,
    message_thread_id: messageThreadId,
  });
}

export async function reopenForumTopic(env: Env, chatId: string | number, messageThreadId: number) {
  return tg(env, 'reopenForumTopic', {
    chat_id: chatId,
    message_thread_id: messageThreadId,
  });
}

export async function sendChatAction(env: Env, chatId: string | number, action: string, extra: Record<string, unknown> = {}) {
  return tg(env, 'sendChatAction', {
    chat_id: chatId,
    action,
    ...extra,
  });
}

export async function getFile(env: Env, fileId: string): Promise<{ file_id: string; file_unique_id?: string; file_size?: number; file_path?: string }> {
  return tg(env, 'getFile', { file_id: fileId });
}

export async function fetchTelegramFile(env: Env, filePath: string): Promise<Response> {
  const base = (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
  return fetch(`${base}/file/bot${env.BOT_TOKEN}/${filePath}`);
}

export async function setWebhook(env: Env, url: string, secretToken?: string) {
  return tg(env, 'setWebhook', {
    url,
    allowed_updates: ['message', 'edited_message', 'callback_query'],
    drop_pending_updates: false,
    ...(secretToken ? { secret_token: secretToken } : {}),
  });
}

export async function setMyCommands(env: Env) {
  const commands = [
    { command: 'setup', description: '初始化/绑定后台群' },
    { command: 'control', description: '打开中文控制台' },
    { command: 'panel', description: '查看当前用户面板' },
    { command: 'help', description: '查看帮助' },
  ];
  await tg(env, 'deleteMyCommands', { scope: { type: 'default' } });
  await tg(env, 'deleteMyCommands', { scope: { type: 'all_private_chats' } });
  await tg(env, 'deleteMyCommands', { scope: { type: 'all_group_chats' } });
  await tg(env, 'deleteMyCommands', { scope: { type: 'all_chat_administrators' } });
  await tg(env, 'setMyCommands', { commands, scope: { type: 'all_group_chats' } });
  await tg(env, 'setMyCommands', { commands, scope: { type: 'all_chat_administrators' } });
  return tg(env, 'setMyCommands', {
    commands: [
      { command: 'start', description: '开始使用客服 Bot' },
      { command: 'help', description: '查看帮助' },
    ],
    scope: { type: 'all_private_chats' },
  });
}


export function html(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function describeFetchError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? ` (${cause.message})` : '';
    return `${err.message}${causeText}`;
  }
  return String(err);
}
