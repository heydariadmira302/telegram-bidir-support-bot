import {
  addAdmin,
  addUserTag,
  blockUser,
  deleteKeywordReply,
  findArchivedUserByChatId,
  findKeywordReply,
  findSensitiveWord,
  getLinkedUser,
  getMessageLogMedia,
  getQuickReply,
  getSetting,
  getUserByChatId,
  getUserByTopicId,
  isBlocked,
  linkSupportMessage,
  listAdmins,
  listKeywordReplies,
  listPendingUsers,
  listQuickReplies,
  listUsers,
  logMessage,
  restoreArchivedUserConversation,
  removeAdmin,
  removeUserTag,
  setKeywordReply,
  setQuickReply,
  setSetting,
  setUserImportant,
  setUserMuted,
  setUserAiMode,
  setUserNote,
  setUserPending,
  setUserStatus,
  setUserTopic,
  unblockUser,
  upsertUser,
} from './db';
import { draftReply, isAiAutoReplyEnabled } from './ai';
import { handleAdminRequest } from './admin';
import { isAuthed } from './admin-auth';
import { handleInstallRequest } from './install';
import { isInstalled, withRuntimeConfig } from './config';
import { resolveTenantByBotId, withTenant } from './tenant';
import {
  applyUserAction,
  createBroadcastDraft,
  removeKeyword,
  saveKeyword,
  saveQuick,
  sendBroadcastDraft,
  listAiModelConfigs,
  removeAiModel,
  toggleAiModel,
  getSupportQueue,
  getSupportWorkbench,
  getWorkbenchStats,
  getSystemStatus,
  updateSetting,
  useAiModel,
  bindBotSupportGroup,
  bindCurrentBotSupportGroup,
  getUserStats,
  topicUrl,
} from './service';
import { answerCallbackQuery, copyMessage, createForumTopic, deleteMessage, editMessageText, fetchTelegramFile, getFile, html, reopenForumTopic, sendChatAction, sendMessage, setMyCommands, setWebhook } from './telegram';
import { isReadOnlySupportPanelAction, parseSupportPanelCallback, supportMessageQuickPanel, supportUserCard, supportUserPanel } from './support-panel';
import { parseWorkbenchCallback, queueKeyboard, queueKindFromAction, queueText, workbenchKeyboard, workbenchText } from './support-workbench';
import { sendOrRefreshWorkbench, syncSupportTopicTitle, topicRecoveryNotice, updateWorkbenchAfterChange } from './support-topic';
import type { Env, RuntimeAdapters, TelegramCallbackQuery, TelegramMessage, TelegramUpdate, TelegramUser, UserRow } from './types';

export async function handleRequest(request: Request, env: Env, ctx?: { waitUntil?: (promise: Promise<unknown>) => void }, adapters: RuntimeAdapters = {}): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/health') return new Response('OK', { headers: { 'content-type': 'text/plain; charset=utf-8' } });

  if (url.pathname.startsWith('/admin/file/')) return handleAdminFileRequest(request, env, adapters);

  if (url.pathname === '/install') return handleInstallRequest(request, env);

  const installed = await isInstalled(env);
  const runtimeEnv = installed ? await withRuntimeConfig(env) : env;

  if (!installed) {
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return handleInstallRequest(request, env);
    return new Response(null, { status: 303, headers: [['location', '/install'], ['cache-control', 'no-store']] });
  }

  if (url.pathname === '/install') return new Response('Not found', { status: 404 });

  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
    return handleAdminRequest(request, runtimeEnv);
  }

  if (url.pathname === '/setup-webhook') {
    const key = url.searchParams.get('key');
    if (runtimeEnv.WEBHOOK_SECRET && key !== runtimeEnv.WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
    const webhookUrl = `${(runtimeEnv.PUBLIC_URL ?? url.origin).replace(/\/$/, '')}/telegram/webhook`;
    await setWebhook(runtimeEnv, webhookUrl, runtimeEnv.WEBHOOK_SECRET);
    await setMyCommands(runtimeEnv);
    return Response.json({ ok: true, webhook: webhookUrl });
  }

  const webhookMatch = url.pathname.match(/^\/telegram\/webhook(?:\/([A-Za-z0-9_-]+))?$/);
  if (!webhookMatch) return new Response('Not found', { status: 404 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const tenant = await resolveTenantByBotId(runtimeEnv, webhookMatch[1] || null);
  if (!tenant) return new Response('Bot not found or disabled', { status: 404 });
  const botEnv = withTenant(runtimeEnv, tenant);

  if (botEnv.WEBHOOK_SECRET) {
    const token = request.headers.get('x-telegram-bot-api-secret-token');
    if (token !== botEnv.WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
  }

  const update = (await request.json()) as TelegramUpdate;
  logWebhookUpdate(update);
  const work = handleUpdate(botEnv, update).catch((err) => {
    console.error('update failed', err);
  });
  if (ctx?.waitUntil) {
    ctx.waitUntil(work);
    return new Response('OK');
  }
  setTimeout(() => { void work; }, 0);
  return new Response('OK');
}

function logWebhookUpdate(update: TelegramUpdate): void {
  const message = update.message ?? update.edited_message;
  if (!message) {
    console.log('telegram update received', { update_id: update.update_id, kind: update.callback_query ? 'callback_query' : 'unknown' });
    return;
  }
  console.log('telegram message received', {
    update_id: update.update_id,
    message_id: message.message_id,
    chat_id: message.chat.id,
    chat_type: message.chat.type,
    types: messageTypes(message),
  });
}

function messageLogText(message: TelegramMessage): string | null {
  const text = message.text ?? message.caption;
  if (text) return text;
  const media = messageMediaMeta(message);
  if (!media) return null;
  if (media.media_type === 'voice') return `[语音消息 ${media.duration ? media.duration + ' 秒' : ''}]`.trim();
  if (media.media_type === 'audio') return `[音频消息 ${media.file_name || ''}]`.trim();
  return `[${media.media_type}]`;
}

function messageMediaMeta(message: TelegramMessage): { media_type?: string | null; file_id?: string | null; file_name?: string | null; mime_type?: string | null; duration?: number | null } | undefined {
  const voice = message.voice as { file_id?: string; duration?: number; mime_type?: string } | undefined;
  if (voice?.file_id) return { media_type: 'voice', file_id: voice.file_id, mime_type: voice.mime_type ?? 'audio/ogg', duration: voice.duration ?? null };
  const audio = message.audio as { file_id?: string; duration?: number; mime_type?: string; file_name?: string } | undefined;
  if (audio?.file_id) return { media_type: 'audio', file_id: audio.file_id, file_name: audio.file_name ?? null, mime_type: audio.mime_type ?? 'audio/mpeg', duration: audio.duration ?? null };
  return undefined;
}

function messageTypes(message: TelegramMessage): string[] {
  return ['text', 'caption', 'photo', 'document', 'video', 'animation', 'audio', 'voice', 'video_note', 'sticker', 'contact', 'location', 'venue']
    .filter((key) => Boolean((message as unknown as Record<string, unknown>)[key]));
}


async function handleAdminFileRequest(request: Request, env: Env, adapters: RuntimeAdapters = {}): Promise<Response> {
  const installed = await isInstalled(env);
  if (!installed) return new Response('Not found', { status: 404 });
  const runtimeEnv = await withRuntimeConfig(env);
  if (!(await isAdminFileAuthed(request, runtimeEnv))) return new Response('Unauthorized', { status: 401 });
  const fileKey = decodeURIComponent(new URL(request.url).pathname.replace('/admin/file/', ''));
  if (!fileKey) return new Response('Missing file id', { status: 400 });
  const numericId = Number(fileKey);
  const media = Number.isFinite(numericId) ? await getMessageLogMedia(runtimeEnv.DB, numericId, runtimeEnv) : null;
  const fileId = media?.file_id || fileKey;
  const fileEnv = media?.bot_id ? await envForMediaBot(runtimeEnv, media.workspace_id || 'default', media.bot_id) : runtimeEnv;
  const file = await getFile(fileEnv, fileId);
  if (!file.file_path) return new Response('File path not found', { status: 404 });
  const res = await fetchTelegramFile(fileEnv, file.file_path);
  if (!res.ok) return new Response('Telegram file fetch failed', { status: res.status });
  const original = new Uint8Array(await res.arrayBuffer());
  const shouldTranscode = media?.media_type === 'voice' || media?.media_type === 'audio' && media?.mime_type?.includes('ogg');
  const body = shouldTranscode
    ? await transcodeAudio(original, `${media?.bot_id || fileEnv.BOT_ID || 'default'}:${fileId}`, media, fileEnv, adapters)
    : original;
  const transcoded = shouldTranscode && body !== original;
  const headers = new Headers();
  headers.set('content-type', transcoded ? 'audio/mpeg' : mediaContentType(media?.mime_type, media?.media_type, res.headers.get('content-type')));
  headers.set('cache-control', 'private, max-age=86400');
  headers.set('accept-ranges', 'bytes');
  headers.set('content-length', String(body.byteLength));
  const filename = media?.file_name || `${media?.media_type || 'telegram-file'}-${fileKey}.${transcoded ? 'mp3' : mediaExtension(media?.mime_type, media?.media_type)}`;
  headers.set('content-disposition', `inline; filename="${filename.replace(/["\\]/g, '_')}"`);
  return new Response(body, { status: 200, headers });
}

async function envForMediaBot(env: Env, workspaceId: string, botId: string): Promise<Env> {
  if (!botId || botId === env.BOT_ID) return env;
  const tenant = await resolveTenantByBotId({ ...env, WORKSPACE_ID: workspaceId }, botId);
  return tenant ? withTenant(env, tenant) : env;
}

async function transcodeAudio(input: Uint8Array, cacheKey: string, media: { media_type?: string | null; mime_type?: string | null } | null, env: Env, adapters: RuntimeAdapters): Promise<Uint8Array> {
  if (adapters.transcodeAudioToMp3) return adapters.transcodeAudioToMp3(input, cacheKey, { mediaType: media?.media_type, mimeType: media?.mime_type });
  if (env.AUDIO_TRANSCODE_URL) return transcodeAudioViaHttp(input, env, media);
  return input;
}

async function transcodeAudioViaHttp(input: Uint8Array, env: Env, media: { media_type?: string | null; mime_type?: string | null } | null): Promise<Uint8Array> {
  const res = await fetch(env.AUDIO_TRANSCODE_URL!, {
    method: 'POST',
    headers: {
      'content-type': mediaContentType(media?.mime_type, media?.media_type, null),
      'accept': 'audio/mpeg',
      ...(env.AUDIO_TRANSCODE_SECRET ? { authorization: `Bearer ${env.AUDIO_TRANSCODE_SECRET}` } : {}),
    },
    body: input,
  });
  if (!res.ok) throw new Error(`audio transcode service failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function mediaContentType(mimeType?: string | null, mediaType?: string | null, upstream?: string | null): string {
  if (mimeType) return mimeType;
  if (mediaType === 'voice') return 'audio/ogg; codecs=opus';
  if (mediaType === 'audio') return upstream || 'audio/mpeg';
  return upstream || 'application/octet-stream';
}

function mediaExtension(mimeType?: string | null, mediaType?: string | null): string {
  if (mimeType?.includes('ogg')) return 'ogg';
  if (mimeType?.includes('mpeg') || mimeType?.includes('mp3')) return 'mp3';
  if (mimeType?.includes('mp4')) return 'mp4';
  return mediaType === 'voice' ? 'ogg' : 'bin';
}

async function isAdminFileAuthed(request: Request, env: Env): Promise<boolean> {
  try {
    return await isAuthed(request, env);
  } catch {
    return false;
  }
}

async function handleUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(env, update.callback_query);
    return;
  }

  const message = update.message ?? update.edited_message;
  if (!message) return;

  const supportChatId = env.SUPPORT_CHAT_ID ? String(env.SUPPORT_CHAT_ID) : '';
  const chatId = String(message.chat.id);

  if (message.chat.type !== 'private' && isBindCommand(message.text)) {
    await handleBindCommand(env, message);
    return;
  }

  if (message.chat.type !== 'private' && (!supportChatId || isCommand(message.text, '/setup'))) {
    await handleSetupHint(env, message);
    return;
  }

  if (message.chat.type === 'private') {
    await handleUserMessage(env, message);
    return;
  }

  if (chatId === supportChatId) {
    await handleSupportMessage(env, message);
  }
}

async function handleCallbackQuery(env: Env, query: TelegramCallbackQuery): Promise<void> {
  const controlAction = parseControlCallback(query.data);
  if (controlAction) {
    await handleControlCallback(env, query, controlAction);
    return;
  }

  const workbenchAction = parseWorkbenchCallback(query.data);
  if (workbenchAction) {
    await handleWorkbenchCallback(env, query, workbenchAction);
    return;
  }
  await handleSupportCallback(env, query);
}


type ControlCallback = { key: 'pending_tracking_enabled' | 'support_message_panel_enabled' | 'support_topic_delete_mode' | 'support_notification_mode'; value: string };

function parseControlCallback(data?: string): ControlCallback | null {
  if (data === 'ctl:digest:on') return { key: 'support_notification_mode', value: 'digest' };
  if (data === 'ctl:digest:off') return { key: 'support_notification_mode', value: 'off' };
  if (data === 'ctl:refresh') return { key: 'pending_tracking_enabled', value: '__refresh__' } as ControlCallback;
  if (data === 'ctl:back') return { key: 'pending_tracking_enabled', value: '__back__' } as ControlCallback;
  const match = /^ctl:(pending|panel|topic):(on|off|notify|close|delete)$/.exec(data || '');
  if (!match) return null;
  const key = match[1] === 'pending' ? 'pending_tracking_enabled' : match[1] === 'panel' ? 'support_message_panel_enabled' : 'support_topic_delete_mode';
  const value = match[2] === 'on' ? 'true' : match[2] === 'off' ? 'false' : match[2];
  return { key, value };
}

async function handleControlCallback(env: Env, query: TelegramCallbackQuery, action: ControlCallback): Promise<void> {
  const supportChatId = env.SUPPORT_CHAT_ID ? String(env.SUPPORT_CHAT_ID) : '';
  if (query.message && supportChatId && String(query.message.chat.id) !== supportChatId) {
    await answerCallbackQuery(env, query.id, '只能在后台群操作');
    return;
  }
  const role = await getSupportAdminRole(env, query.from.id);
  if (role !== 'owner') {
    await answerCallbackQuery(env, query.id, '只有 owner 可以修改控制台开关');
    return;
  }
  if (action.value === '__back__') {
    const [summary, stats] = await Promise.all([getSupportWorkbench(env), getWorkbenchStats(env)]);
    await editOrSendCallbackMessage(env, query, workbenchText(summary, stats), workbenchKeyboard());
    await answerCallbackQuery(env, query.id, '已返回工作台');
    return;
  }
  if (action.value !== '__refresh__') await updateSetting(env, action.key, action.value);
  const text = await controlPanelText(env);
  if (query.message) await editOrSendCallbackMessage(env, query, text, await controlPanelKeyboard(env));
  else if (env.SUPPORT_CHAT_ID) await sendMessage(env, env.SUPPORT_CHAT_ID, text, { reply_markup: await controlPanelKeyboard(env) });
  await answerCallbackQuery(env, query.id, action.value === '__refresh__' ? '已刷新' : '已更新');
}

async function controlPanelText(env: Env): Promise<string> {
  const pending = (await getSetting(env.DB, 'pending_tracking_enabled', env)) !== 'false';
  const panel = (await getSetting(env.DB, 'support_message_panel_enabled', env)) !== 'false';
  const topicMode = (await getSetting(env.DB, 'support_topic_delete_mode', env)) || 'close';
  const digest = (await getSetting(env.DB, 'support_notification_mode', env)) === 'digest';
  const topicText = topicMode === 'delete' ? '直接删除 Topic' : topicMode === 'notify' ? '只提示，不关闭' : '提示并关闭 Topic';
  return [
    '⚙️ <b>中文控制台</b>',
    '',
    `待跟进状态：<b>${pending ? '开启' : '关闭'}</b>`,
    `每条消息按钮：<b>${panel ? '开启' : '关闭'}</b>`,
    `删除会话后：<b>${topicText}</b>`,
    `新消息摘要：<b>${digest ? '开启' : '关闭'}</b>`,
    '',
    '直接点下面按钮即可切换。',
  ].join('\n');
}

async function controlPanelKeyboard(env: Env) {
  const pending = (await getSetting(env.DB, 'pending_tracking_enabled', env)) !== 'false';
  const panel = (await getSetting(env.DB, 'support_message_panel_enabled', env)) !== 'false';
  const topicMode = (await getSetting(env.DB, 'support_topic_delete_mode', env)) || 'close';
  const digest = (await getSetting(env.DB, 'support_notification_mode', env)) === 'digest';
  return {
    inline_keyboard: [
      [{ text: `待跟进：${pending ? '开启 ✅' : '关闭 ⛔'}`, callback_data: `ctl:pending:${pending ? 'off' : 'on'}` }],
      [{ text: `每条消息按钮：${panel ? '开启 ✅' : '关闭 ⛔'}`, callback_data: `ctl:panel:${panel ? 'off' : 'on'}` }],
      [
        { text: `${topicMode === 'notify' ? '✅ ' : ''}删除后只提示`, callback_data: 'ctl:topic:notify' },
        { text: `${topicMode === 'close' ? '✅ ' : ''}删除后关闭`, callback_data: 'ctl:topic:close' },
      ],
      [{ text: `${topicMode === 'delete' ? '✅ ' : ''}删除后直接删 Topic`, callback_data: 'ctl:topic:delete' }],
      [{ text: `新消息摘要：${digest ? '开启 ✅' : '关闭 ⛔'}`, callback_data: `ctl:digest:${digest ? 'off' : 'on'}` }],
      [
        { text: '↩️ 返回工作台', callback_data: 'ctl:back' },
        { text: '✖️ 关闭面板', callback_data: 'card:close' },
      ],
      [{ text: '🔄 刷新', callback_data: 'ctl:refresh' }],
    ],
  };
}

async function handleWorkbenchCallback(env: Env, query: TelegramCallbackQuery, action: NonNullable<ReturnType<typeof parseWorkbenchCallback>>): Promise<void> {
  const supportChatId = env.SUPPORT_CHAT_ID ? String(env.SUPPORT_CHAT_ID) : '';
  if (query.message && supportChatId && String(query.message.chat.id) !== supportChatId) {
    await answerCallbackQuery(env, query.id, '只能在后台群操作');
    return;
  }

  const role = await getSupportAdminRole(env, query.from.id);
  if (!role) {
    await answerCallbackQuery(env, query.id, '只有后台管理员可以操作');
    return;
  }

  const queueKind = queueKindFromAction(action);
  if (queueKind) {
    const panel = await getSupportQueue(env, queueKind, 10);
    await editOrSendCallbackMessage(env, query, queueText(env, panel), queueKeyboard(env, panel));
    await answerCallbackQuery(env, query.id, '已打开队列');
    return;
  }

  const [summary, stats] = await Promise.all([getSupportWorkbench(env), getWorkbenchStats(env)]);
  await editOrSendCallbackMessage(env, query, workbenchText(summary, stats), workbenchKeyboard());
  await answerCallbackQuery(env, query.id, '已刷新工作台');
}

async function editOrSendCallbackMessage(env: Env, query: TelegramCallbackQuery, text: string, replyMarkup: Record<string, unknown>): Promise<void> {
  if (query.message) {
    try {
      await editMessageText(env, query.message.chat.id, query.message.message_id, text, { reply_markup: replyMarkup });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('message is not modified')) throw err;
    }
    return;
  }
  if (env.SUPPORT_CHAT_ID) await sendMessage(env, env.SUPPORT_CHAT_ID, text, { reply_markup: replyMarkup });
}

async function handleSupportCallback(env: Env, query: TelegramCallbackQuery): Promise<void> {
  if (query.data === 'card:close') {
    if (query.message) {
      await deleteMessage(env, query.message.chat.id, query.message.message_id);
      await answerCallbackQuery(env, query.id, '已关闭卡片');
    } else {
      await answerCallbackQuery(env, query.id, '找不到要关闭的卡片');
    }
    return;
  }

  const parsed = parseSupportPanelCallback(query.data);
  if (!parsed) {
    await answerCallbackQuery(env, query.id, '不支持的按钮');
    return;
  }

  const supportChatId = env.SUPPORT_CHAT_ID ? String(env.SUPPORT_CHAT_ID) : '';
  if (query.message && supportChatId && String(query.message.chat.id) !== supportChatId) {
    await answerCallbackQuery(env, query.id, '只能在后台群操作');
    return;
  }

  const role = await getSupportAdminRole(env, query.from.id);
  if (!role) {
    await answerCallbackQuery(env, query.id, '只有后台管理员可以操作');
    return;
  }

  const row = await getUserByChatId(env.DB, parsed.userId, env);
  if (!row) {
    await answerCallbackQuery(env, query.id, '找不到这个用户');
    return;
  }

  if (role === 'readonly' && !isReadOnlySupportPanelAction(parsed.action)) {
    await answerCallbackQuery(env, query.id, 'readonly 只能查看，不能执行写操作');
    return;
  }

  const thread = { message_thread_id: row.topic_id ?? query.message?.message_thread_id };

  try {
    if (parsed.action === 'info') {
      await refreshSupportUserCard(env, row, query);
      await answerCallbackQuery(env, query.id, '已刷新资料');
      return;
    }

    if (parsed.action === 'contact') {
      await refreshSupportUserCard(env, row, query, 'contact');
      await answerCallbackQuery(env, query.id, '已切换联系信息');
      return;
    }

    if (parsed.action === 'stats') {
      const data = await getUserStats(env, parsed.userId);
      await editOrSendStatsCard(env, query, formatUserStatsCard(data), data.user);
      await answerCallbackQuery(env, query.id, '已打开互动统计');
      return;
    }

    if (parsed.action === 'block') {
      await answerCallbackQuery(env, query.id, '请再次确认拉黑');
      await refreshSupportUserCard(env, row, query, 'confirm_block');
      return;
    }

    const actionMap = {
      done: 'mark_replied',
      pending: 'mark_pending',
      close: 'close',
      open: 'open',
      pin: 'pin',
      unpin: 'unpin',
      mute: 'mute',
      unmute: 'unmute',
      block_ok: 'block',
      unblock: 'unblock',
    } as const;
    const action = actionMap[parsed.action as keyof typeof actionMap];
    if (!action) {
      await answerCallbackQuery(env, query.id, '不支持的操作');
      return;
    }

    await applyUserAction(env, parsed.userId, action);
    const updated = await getUserByChatId(env.DB, parsed.userId, env);
    await answerCallbackQuery(env, query.id, supportActionDoneText(parsed.action));
    if (updated) {
      await syncSupportTopicTitle(env, updated);
      await refreshSupportUserCard(env, updated, query);
      await refreshWorkbenchSilently(env);
    }
  } catch (err) {
    await answerCallbackQuery(env, query.id, err instanceof Error ? err.message.slice(0, 180) : '操作失败');
    console.error('support callback failed', err);
  }
}

async function sendSupportUserCard(env: Env, row: UserRow): Promise<void> {
  if (!row.topic_id) return;
  const pendingTracking = await isPendingTrackingEnabled(env);
  await sendMessage(env, env.SUPPORT_CHAT_ID, supportUserCard(row, 'normal', { pendingTracking }), {
    message_thread_id: row.topic_id,
    reply_markup: supportUserPanel(row, 'normal', { pendingTracking }),
  });
}

async function refreshSupportUserCard(
  env: Env,
  row: UserRow,
  query: TelegramCallbackQuery,
  mode: 'normal' | 'contact' | 'confirm_block' = 'normal',
): Promise<void> {
  const pendingTracking = await isPendingTrackingEnabled(env);
  const text = supportUserCard(row, mode, { pendingTracking });
  const replyMarkup = closablePanel(supportUserPanel(row, mode, { pendingTracking }));
  if (query.message) {
    try {
      await editMessageText(env, query.message.chat.id, query.message.message_id, text, {
        reply_markup: replyMarkup,
      });
      return;
    } catch (err) {
      if (!isTelegramMessageNotEditableError(err)) throw err;
      if (supportCardFallbackEnabled(env)) {
        await sendMessage(env, query.message.chat.id, text, {
          message_thread_id: row.topic_id ?? query.message.message_thread_id,
          reply_markup: replyMarkup,
        });
      } else {
        await answerCallbackQuery(env, query.id, '这条复制消息不能编辑；已关闭补发卡片。');
      }
      return;
    }
  }
  await sendSupportUserCard(env, row);
}

async function editOrSendStatsCard(env: Env, query: TelegramCallbackQuery, text: string, row: UserRow): Promise<void> {
  const replyMarkup = closablePanel({ inline_keyboard: [[{ text: '↩️ 返回用户资料', callback_data: `u:${row.user_chat_id}:info` }]] });
  if (query.message) {
    try {
      await editMessageText(env, query.message.chat.id, query.message.message_id, text, { reply_markup: replyMarkup });
      return;
    } catch (err) {
      if (!isTelegramMessageNotEditableError(err)) throw err;
      if (supportCardFallbackEnabled(env)) {
        await sendMessage(env, query.message.chat.id, text, {
          message_thread_id: row.topic_id ?? query.message.message_thread_id,
          reply_markup: replyMarkup,
        });
      } else {
        await answerCallbackQuery(env, query.id, '这条复制消息不能编辑；已关闭补发统计卡片。');
      }
      return;
    }
  }
  if (env.SUPPORT_CHAT_ID) await sendMessage(env, env.SUPPORT_CHAT_ID, text, { message_thread_id: row.topic_id ?? undefined, reply_markup: replyMarkup });
}

function supportCardFallbackEnabled(env: Env): boolean {
  return env.SUPPORT_CARD_FALLBACK !== 'false';
}

function closablePanel(markup: { inline_keyboard: Array<Array<Record<string, string>>> }) {
  return { inline_keyboard: [...markup.inline_keyboard, [{ text: '✖️ 关闭卡片', callback_data: 'card:close' }]] };
}

function isTelegramMessageNotEditableError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return text.includes("message can't be edited") || text.includes('message is not modified');
}

function formatUserStatsCard(data: Awaited<ReturnType<typeof getUserStats>>): string {
  const row = data.user;
  const stats = data.stats;
  const status = [row.pending ? '待跟进' : '已处理', row.is_blocked ? '已拉黑' : '', row.important ? '重要' : '', row.muted ? '静音' : ''].filter(Boolean).join(' · ');
  return [
    '📊 <b>互动统计</b>',
    '',
    `用户 ID：<code>${html(row.user_chat_id)}</code>`,
    `当前状态：<b>${html(status || '正常')}</b>`,
    `标签：${html(row.tags || '无')}`,
    '',
    `总消息：<b>${stats.total_messages}</b>`,
    `客户消息：<b>${stats.inbound_messages}</b>`,
    `客服回复：<b>${stats.outbound_messages}</b>`,
    `最近 7 天：<b>${stats.messages_7d}</b>`,
    '',
    `首次接入：${html(formatStatTime(stats.first_message_at))}`,
    `最近互动：${html(formatStatTime(stats.last_message_at))}`,
    `最近客户发言：${html(formatStatTime(stats.last_inbound_at))}`,
    `最近客服回复：${html(formatStatTime(stats.last_outbound_at))}`,
    stats.waiting_seconds ? `客户已等待：<b>${html(formatDuration(stats.waiting_seconds))}</b>` : '',
  ].filter(Boolean).join('\n');
}

function formatStatTime(value?: string | null): string {
  return value || '暂无';
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function supportActionDoneText(action: string): string {
  const map: Record<string, string> = {
    done: '已标记为已处理',
    pending: '已标记为待处理',
    close: '会话已关闭',
    open: '会话已重开',
    pin: '已标记重要',
    unpin: '已取消重要',
    mute: '已静音',
    unmute: '已取消静音',
    block_ok: '已拉黑',
    unblock: '已解除拉黑',
  };
  return map[action] ?? '操作完成';
}

async function handleUserMessage(env: Env, message: TelegramMessage): Promise<void> {
  const user = message.from;
  if (!user || user.is_bot) return;

  const userChatId = String(user.id);
  if (!env.SUPPORT_CHAT_ID) {
    await sendMessage(env, userChatId, '客服系统还没有配置后台群，请稍后再试。');
    console.warn('support chat is not configured', { workspaceId: env.WORKSPACE_ID, botId: env.BOT_ID });
    return;
  }
  let existingUser = await getUserByChatId(env.DB, userChatId, env);
  const archived = existingUser?.status === 'archived' ? existingUser : await findArchivedUserByChatId(env.DB, userChatId, env);
  if (archived) {
    await restoreArchivedUserConversation(env.DB, userChatId, archived);
    existingUser = await getUserByChatId(env.DB, userChatId, { WORKSPACE_ID: archived.workspace_id || env.WORKSPACE_ID, BOT_ID: archived.bot_id || env.BOT_ID });
  } else {
    await upsertUser(env.DB, user, undefined, env);
    existingUser = await getUserByChatId(env.DB, userChatId, env);
  }
  const activeEnv = existingUser?.bot_id && existingUser.bot_id !== env.BOT_ID ? { ...env, BOT_ID: existingUser.bot_id, WORKSPACE_ID: existingUser.workspace_id || env.WORKSPACE_ID } : env;
  const pendingTrackingEnabled = await isPendingTrackingEnabled(env);
  if (pendingTrackingEnabled) await setUserPending(activeEnv.DB, userChatId, true, activeEnv);
  await logMessage(activeEnv.DB, userChatId, 'in', message.message_id, messageLogText(message), activeEnv, messageMediaMeta(message));

  if (!existingUser) await sendWelcomeMessage(env, userChatId);

  if (await isRateLimited(env, userChatId)) {
    await sendMessage(env, userChatId, '你发送得有点快，请稍等一下再继续。');
    return;
  }

  if (await isBlocked(activeEnv.DB, userChatId, activeEnv)) {
    await sendMessage(env, userChatId, '你当前暂时不能发送消息。');
    return;
  }

  let row = await ensureTopic(activeEnv, user);

  if (row.status === 'archived') {
    await reactivateArchivedConversation(activeEnv, row);
    row = await getUserByChatId(activeEnv.DB, userChatId, activeEnv) ?? row;
  }

  if (row.status === 'closed') {
    await setUserStatus(activeEnv.DB, userChatId, 'open', activeEnv);
    const reopenedText = (await getSetting(env.DB, 'closed_message', env)) ?? '这个会话已重新打开，请继续发送你的问题。';
    await sendMessage(env, userChatId, reopenedText);
    await notifySupport(activeEnv, row, user, '用户重新打开了会话。');
  }

  if (isCommand(message.text, '/start')) {
    if (existingUser) await sendWelcomeMessage(env, userChatId);
    if ((await getSetting(activeEnv.DB, 'support_notification_mode', activeEnv)) !== 'digest') await notifySupport(activeEnv, row, user, '用户启动了 bot。');
    return;
  }

  try {
    await forwardUserMessageToSupport(activeEnv, row, userChatId, message);
  } catch (err) {
    if (isTelegramThreadMissingError(err)) {
      console.warn('support topic missing, recreating', { userChatId, topicId: row.topic_id });
      row = await recreateTopic(activeEnv, user);
      await sendMessage(activeEnv, activeEnv.SUPPORT_CHAT_ID, topicRecoveryNotice(row), { message_thread_id: row.topic_id });
      try {
        await forwardUserMessageToSupport(activeEnv, row, userChatId, message);
        return;
      } catch (retryErr) {
        console.error('copy user message retry failed', retryErr);
        await notifyCopyFailure(activeEnv, row, userChatId, message);
        return;
      }
    }
    console.error('copy user message failed', err);
    await notifyCopyFailure(activeEnv, row, userChatId, message);
  }
}

async function isPendingTrackingEnabled(env: Env): Promise<boolean> {
  return (await getSetting(env.DB, 'pending_tracking_enabled', env)) !== 'false';
}

async function isSupportMessagePanelEnabled(env: Env): Promise<boolean> {
  return (await getSetting(env.DB, 'support_message_panel_enabled', env)) !== 'false';
}

async function sendWelcomeMessage(env: Env, userChatId: string): Promise<void> {
  const welcome = (await getSetting(env.DB, 'welcome_message', env)) ?? '你好，消息已接入。你直接在这里发送内容，我会转给对方；对方回复后也会从这里发回给你。';
  if (welcome.trim()) await sendMessage(env, userChatId, welcome);
}

async function forwardUserMessageToSupport(env: Env, row: UserRow, userChatId: string, message: TelegramMessage): Promise<void> {
  const panelEnabled = await isSupportMessagePanelEnabled(env);
  const copied = await copyMessage(env, env.SUPPORT_CHAT_ID, userChatId, message.message_id, {
    message_thread_id: row.topic_id,
    ...(panelEnabled ? { reply_markup: supportMessageQuickPanel(row, { pendingTracking: await isPendingTrackingEnabled(env) }) } : {}),
  });
  await linkSupportMessage(env.DB, String(env.SUPPORT_CHAT_ID), copied.message_id, userChatId, message.message_id, env);
  await sendDigestNotification(env, row, message);
  await maybeSensitiveAlert(env, row, message);
  await maybeAutoRespond(env, userChatId, row, message);
  if (row.important && !row.muted) {
    await sendMessage(env, env.SUPPORT_CHAT_ID, '⭐ 重要用户有新消息', { message_thread_id: row.topic_id });
  }
}

async function notifyCopyFailure(env: Env, row: UserRow, userChatId: string, message?: TelegramMessage): Promise<void> {
  const extra = row.topic_id ? { message_thread_id: row.topic_id } : {};
  const fallbackText = message ? userMessageFallbackText(userChatId, message) : '';
  try {
    await sendMessage(env, env.SUPPORT_CHAT_ID, fallbackText || `⚠️ 消息复制失败，用户 <code>${html(userChatId)}</code> 发送了一个暂不支持复制的消息。`, extra);
  } catch (err) {
    await sendMessage(env, env.SUPPORT_CHAT_ID, fallbackText || `⚠️ 消息复制失败，且原 Topic 可能不可用。用户 <code>${html(userChatId)}</code> 发送了一个暂不支持复制的消息。`);
    console.error('notify copy failure in topic failed', err);
  }
}

function userMessageFallbackText(userChatId: string, message: TelegramMessage): string {
  const text = message.text ?? message.caption ?? '';
  const types = messageTypes(message).filter((x) => x !== 'text' && x !== 'caption');
  return [
    `⚠️ 无法复制客户原消息，已改为文本备份。`,
    `用户：<code>${html(userChatId)}</code>`,
    types.length ? `类型：${html(types.join(', '))}` : '',
    text ? `内容：\n${html(text)}` : '内容：这个消息类型 Telegram 不允许复制，且没有文本内容。',
  ].filter(Boolean).join('\n');
}

async function ensureTopic(env: Env, user: TelegramUser): Promise<UserRow> {
  const userChatId = String(user.id);
  const existing = await getUserByChatId(env.DB, userChatId, env);
  if (existing?.topic_id) {
    if (await isTopicUsable(env, existing.topic_id)) return existing;
    console.warn('stored support topic is not usable, recreating', { userChatId, topicId: existing.topic_id });
    return recreateTopic(env, user);
  }
  return createTopicForUser(env, user);
}

async function reactivateArchivedConversation(env: Env, row: UserRow): Promise<void> {
  if (row.topic_id && env.SUPPORT_CHAT_ID) {
    try {
      await reopenForumTopic(env, env.SUPPORT_CHAT_ID, row.topic_id);
    } catch (err) {
      if (!isTelegramThreadMissingError(err)) console.warn('reopen archived topic failed', err);
    }
  }
  await setUserStatus(env.DB, row.user_chat_id, 'open');
  const next = await getUserByChatId(env.DB, row.user_chat_id, env);
  if (next) await syncSupportTopicTitle(env, next);
}

async function recreateTopic(env: Env, user: TelegramUser): Promise<UserRow> {
  await setUserTopic(env.DB, String(user.id), null, env);
  return createTopicForUser(env, user);
}

async function createTopicForUser(env: Env, user: TelegramUser): Promise<UserRow> {
  const userChatId = String(user.id);
  const topicName = topicTitle(user);
  let topic: Awaited<ReturnType<typeof createForumTopic>>;
  try {
    topic = await createForumTopic(env, env.SUPPORT_CHAT_ID, topicName);
  } catch (err) {
    throw new Error(`创建客服 Topic 失败：${supportTopicErrorMessage(err)}`);
  }
  await setUserTopic(env.DB, userChatId, topic.message_thread_id, env);

  const row = await getUserByChatId(env.DB, userChatId, env);
  if (!row) throw new Error('user row missing after topic creation');

  await syncSupportTopicTitle(env, row);
  if ((await getSetting(env.DB, 'support_notification_mode', env)) !== 'digest') await sendSupportUserCard(env, row);
  return row;
}

async function isTopicUsable(env: Env, topicId: number): Promise<boolean> {
  try {
    await sendChatAction(env, env.SUPPORT_CHAT_ID, 'typing', { message_thread_id: topicId });
    return true;
  } catch (err) {
    if (isTelegramThreadMissingError(err)) return false;
    console.warn('topic usability check failed, keeping stored topic', err);
    return true;
  }
}

function isTelegramThreadMissingError(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${JSON.stringify((err as { payload?: unknown }).payload ?? '')}` : String(err);
  return text.includes('message thread not found') || text.includes('message_thread_id') || text.includes('thread not found') || text.includes('TOPIC_DELETED');
}

function supportTopicErrorMessage(err: unknown): string {
  const text = err instanceof Error ? `${err.message} ${JSON.stringify((err as { payload?: unknown }).payload ?? '')}` : String(err);
  if (text.includes('not enough rights')) return 'Bot 不是后台群管理员，或缺少“管理话题/Manage Topics”权限。';
  if (text.includes('CHAT_ADMIN_REQUIRED')) return 'Bot 需要在后台群里设为管理员，并允许管理话题。';
  if (text.includes('TOPIC')) return '后台群可能没有开启“话题 / Topics”。请开启话题后重新绑定。';
  if (text.includes('chat not found')) return '后台群 ID 不正确，或 Bot 不在这个群里。';
  return text;
}

async function refreshUserPresentation(env: Env, userId: string): Promise<void> {
  const row = await getUserByChatId(env.DB, userId, env);
  if (row) await syncSupportTopicTitle(env, row);
  await refreshWorkbenchSilently(env);
}

async function refreshWorkbenchSilently(env: Env): Promise<void> {
  const [summary, stats] = await Promise.all([getSupportWorkbench(env), getWorkbenchStats(env)]);
  await updateWorkbenchAfterChange(env, workbenchText(summary, stats));
}

async function notifySupport(env: Env, row: UserRow, user: TelegramUser, text: string): Promise<void> {
  if (!row.topic_id) return;
  const pendingTracking = await isPendingTrackingEnabled(env);
  try {
    await sendMessage(env, env.SUPPORT_CHAT_ID, `ℹ️ ${html(text)}\n\n${supportUserCard(row, 'normal', { pendingTracking })}`, {
      message_thread_id: row.topic_id,
      reply_markup: supportUserPanel(row, 'normal', { pendingTracking }),
    });
  } catch (err) {
    if (!isTelegramThreadMissingError(err)) throw err;
    console.warn('notify support topic missing, recreating', { userChatId: row.user_chat_id, topicId: row.topic_id });
    const recreated = await recreateTopic(env, user);
    await sendMessage(env, env.SUPPORT_CHAT_ID, topicRecoveryNotice(recreated), { message_thread_id: recreated.topic_id });
    await sendMessage(env, env.SUPPORT_CHAT_ID, `ℹ️ ${html(text)}\n\n${supportUserCard(recreated, 'normal', { pendingTracking })}`, {
      message_thread_id: recreated.topic_id,
      reply_markup: supportUserPanel(recreated, 'normal', { pendingTracking }),
    });
  }
}

async function sendDigestNotification(env: Env, row: UserRow, message: TelegramMessage): Promise<void> {
  const mode = (await getSetting(env.DB, 'support_notification_mode', env)) || 'off';
  if (mode !== 'digest' || !env.SUPPORT_CHAT_ID || !row.topic_id) return;
  const digestThreadId = Number(await getSetting(env.DB, 'support_digest_thread_id', env) || 0) || undefined;
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.username || row.user_chat_id;
  const preview = digestPreview(message);
  const url = topicUrl(env, row);
  await sendMessage(env, env.SUPPORT_CHAT_ID, [
    '📩 <b>新消息</b>',
    '',
    `客户：<b>${html(name)}</b>${row.username ? ` @${html(row.username)}` : ''}`,
    `ID：<code>${html(row.user_chat_id)}</code>`,
    row.tags ? `标签：${html(row.tags)}` : '',
    preview ? `内容：${html(preview)}` : '',
  ].filter(Boolean).join('\n'), {
    ...(digestThreadId ? { message_thread_id: digestThreadId } : {}),
    reply_markup: url ? { inline_keyboard: [[{ text: '打开会话', url }]] } : undefined,
  });
}

function digestPreview(message: TelegramMessage): string {
  const text = (message.text ?? message.caption ?? '').trim();
  if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  const types = messageTypes(message).filter((x) => x !== 'text' && x !== 'caption');
  return types.length ? `[${types.join(', ')}]` : '';
}

async function maybeSensitiveAlert(env: Env, row: UserRow, message: TelegramMessage): Promise<void> {
  const text = message.text ?? message.caption;
  if (!text || !row.topic_id) return;
  const word = await findSensitiveWord(env.DB, text, env);
  if (word) {
    await sendMessage(env, env.SUPPORT_CHAT_ID, `⚠️ 敏感词提醒：<code>${html(word)}</code>\n建议人工优先处理，不要让 AI 自动回复敏感问题。`, { message_thread_id: row.topic_id });
  }
}

async function maybeAutoRespond(env: Env, userChatId: string, row: UserRow, message: TelegramMessage): Promise<void> {
  const text = message.text ?? message.caption;
  if (!text || !row.topic_id) return;

  const keyword = await findKeywordReply(env.DB, text);
  if (keyword) {
    await sendMessage(env, userChatId, keyword.reply);
    await logMessage(env.DB, userChatId, 'out', message.message_id, `[keyword:${keyword.keyword}] ${keyword.reply}`, env);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `🤖 已触发关键词自动回复：<code>${html(keyword.keyword)}</code>`, { message_thread_id: row.topic_id });
    return;
  }

  if (row.ai_mode === 'auto' || (await isAiAutoReplyEnabled(env))) {
    try {
      const reply = await draftReply(env, userChatId, text);
      await sendMessage(env, userChatId, reply);
      await logMessage(env.DB, userChatId, 'out', message.message_id, `[ai] ${reply}`, env);
      await sendMessage(env, env.SUPPORT_CHAT_ID, `🤖 AI 已自动回复：\n${html(reply)}`, { message_thread_id: row.topic_id });
    } catch (err) {
      await sendMessage(env, env.SUPPORT_CHAT_ID, '⚠️ AI 自动回复失败，已转人工处理。', { message_thread_id: row.topic_id });
      console.error('ai auto reply failed', err);
    }
  }
}

async function handleSupportMessage(env: Env, message: TelegramMessage): Promise<void> {
  if (!message.from || message.from.is_bot) return;
  const role = await getSupportAdminRole(env, message.from.id);
  if (!role) return;

  const text = message.text?.trim() ?? '';
  if (isWelcomePromptReply(message) || await consumePendingWelcomeInput(env, message)) {
    if (role === 'readonly') { await sendMessage(env, env.SUPPORT_CHAT_ID, 'readonly 只能查看欢迎语，不能修改。', { message_thread_id: message.message_thread_id }); return; }
    await updateSetting(env, 'welcome_message', message.text ?? message.caption ?? '');
    await sendMessage(env, env.SUPPORT_CHAT_ID, `欢迎语已更新：\n${html(message.text ?? message.caption ?? '')}`, { message_thread_id: message.message_thread_id });
    return;
  }
  if (text.startsWith('/')) {
    await handleSupportCommand(env, message, text);
    return;
  }

  const targetUser = await resolveTargetUser(env, message);
  if (!targetUser) {
    console.warn('support message target not found', {
      message_id: message.message_id,
      thread_id: message.message_thread_id,
      reply_to_message_id: message.reply_to_message?.message_id,
      types: messageTypes(message),
    });
    if (message.message_thread_id) {
      await sendMessage(env, env.SUPPORT_CHAT_ID, '⚠️ 没找到这个 Topic 对应的用户，附件/消息没有转发。请先在该用户工单 Topic 内回复，或回复一条已转发的用户消息。', { message_thread_id: message.message_thread_id });
    }
    return;
  }

  try {
    console.log('copy support message to user', { message_id: message.message_id, thread_id: message.message_thread_id, target_user: targetUser, types: messageTypes(message) });
    const copied = await copyMessage(env, targetUser, env.SUPPORT_CHAT_ID, message.message_id);
    await linkSupportMessage(env.DB, String(env.SUPPORT_CHAT_ID), message.message_id, targetUser, copied.message_id, env);
    await logMessage(env.DB, targetUser, 'out', copied.message_id, message.text ?? message.caption ?? null, env);
    if (await isPendingTrackingEnabled(env)) await setUserPending(env.DB, targetUser, false);
  } catch (err) {
    await sendMessage(env, env.SUPPORT_CHAT_ID, '⚠️ 发送给用户失败，可能是用户拉黑了 bot 或消息类型不支持。', {
      message_thread_id: message.message_thread_id,
    });
    console.error('copy support message failed', err);
  }
}

function isWelcomePromptReply(message: TelegramMessage): boolean {
  const prompt = message.reply_to_message?.text ?? '';
  return prompt.includes('欢迎语设置') && prompt.includes('直接回复这条消息');
}

async function markPendingWelcomeInput(env: Env, message: TelegramMessage): Promise<void> {
  if (!message.from) return;
  await setSetting(env.DB, pendingWelcomeKey(message), String(Date.now() + 5 * 60 * 1000), env);
}

async function consumePendingWelcomeInput(env: Env, message: TelegramMessage): Promise<boolean> {
  if (!message.from || !(message.text || message.caption)) return false;
  const rawText = (message.text ?? message.caption ?? '').trim();
  if (!rawText || rawText.startsWith('/')) return false;
  const key = pendingWelcomeKey(message);
  const expiresAt = Number(await getSetting(env.DB, key, env) || 0);
  if (!expiresAt) return false;
  await setSetting(env.DB, key, '', env);
  return expiresAt >= Date.now();
}

function pendingWelcomeKey(message: TelegramMessage): string {
  return `pending_welcome:${message.chat.id}:${message.from?.id ?? ''}`;
}

async function resolveTargetUser(env: Env, message: TelegramMessage): Promise<string | null> {
  if (message.message_thread_id) {
    const row = await getUserByTopicId(env.DB, message.message_thread_id, env);
    if (row) return row.user_chat_id;
  }

  const replyId = message.reply_to_message?.message_id;
  if (replyId) {
    return getLinkedUser(env.DB, String(env.SUPPORT_CHAT_ID), replyId, env);
  }

  return null;
}

async function handleBindCommand(env: Env, message: TelegramMessage): Promise<void> {
  const code = (message.text ?? '').trim().split(/\s+/)[1] ?? '';
  const thread = { message_thread_id: message.message_thread_id };
  try {
    const bot = code
      ? await bindBotSupportGroup(env, {
          code,
          supportChatId: String(message.chat.id),
          actorUserId: message.from?.id,
          isForum: message.chat.is_forum,
          title: message.chat.title,
        })
      : await bindCurrentBotSupportGroup(env, {
          supportChatId: String(message.chat.id),
          actorUserId: message.from?.id,
          isForum: message.chat.is_forum,
          title: message.chat.title,
        });
    await sendMessage(env, message.chat.id, `✅ 已绑定这个群为 <b>${html(bot.name)}</b> 的后台群。\n\n以后客户私聊这个 Bot，会进入本群的独立 Topic。`, thread);
  } catch (err) {
    await sendMessage(env, message.chat.id, `绑定失败：${html(err instanceof Error ? err.message : String(err))}`, thread);
  }
}

async function handleSupportCommand(env: Env, message: TelegramMessage, text: string): Promise<void> {
  const role = message.from ? await getSupportAdminRole(env, message.from.id) : null;
  if (!role) return;
  const [cmdRaw, arg, ...rest] = text.split(/\s+/);
  const cmd = normalizeSupportCommand(stripBotName(cmdRaw));
  const target = arg && /^-?\d+$/.test(arg) ? arg : await resolveTargetUser(env, message);
  const thread = { message_thread_id: message.message_thread_id };

  if (cmd === '/setup') {
    await handleSetupHint(env, message);
    return;
  }

  if (cmd === '/id') {
    await sendMessage(env, env.SUPPORT_CHAT_ID, `chat_id: <code>${html(message.chat.id)}</code>\nthread_id: <code>${html(message.message_thread_id ?? '')}</code>`, thread);
    return;
  }

  if (cmd === '/info' && target) {
    const row = await getUserByChatId(env.DB, target, env);
    await sendMessage(env, env.SUPPORT_CHAT_ID, row ? userInfo(row) : `找不到用户 <code>${html(target)}</code>`, thread);
    return;
  }

  if (cmd === '/contact' && target) {
    const row = await getUserByChatId(env.DB, target, env);
    await sendMessage(env, env.SUPPORT_CHAT_ID, row ? contactInfo(row) : `找不到用户 <code>${html(target)}</code>`, thread);
    return;
  }

  if (cmd === '/panel' && target) {
    const row = await getUserByChatId(env.DB, target, env);
    if (!row) {
      await sendMessage(env, env.SUPPORT_CHAT_ID, `找不到用户 <code>${html(target)}</code>`, thread);
      return;
    }
    await sendSupportUserCard(env, row);
    return;
  }

  if (cmd === '/workbench') {
    await sendWorkbench(env, message);
    return;
  }

  if (cmd === '/admin') {
    if (role !== 'owner') { await sendMessage(env, env.SUPPORT_CHAT_ID, '只有 owner 可以管理管理员。', thread); return; }
    await handleAdminCommand(env, message, arg, rest);
    return;
  }

  if (cmd === '/users') {
    await handleUsersCommand(env, message, arg);
    return;
  }

  if (cmd === '/recent') {
    await handleQueueCommand(env, message, 'recent');
    return;
  }

  if (cmd === '/pending') {
    await handleQueueCommand(env, message, 'pending');
    return;
  }

  if (cmd === '/broadcast') {
    if (role === 'readonly') { await sendMessage(env, env.SUPPORT_CHAT_ID, 'readonly 只能查看，不能创建广播。', thread); return; }
    await handleBroadcastCommand(env, message, arg, rest);
    return;
  }

  if (cmd === '/confirm_broadcast') {
    if (role === 'readonly') { await sendMessage(env, env.SUPPORT_CHAT_ID, 'readonly 只能查看，不能发送广播。', thread); return; }
    await confirmBroadcast(env, message, arg);
    return;
  }

  if (cmd === '/check') {
    await handleCheck(env, message);
    return;
  }

  if (cmd === '/control' || cmd === '/settings') {
    if (role !== 'owner') { await sendMessage(env, env.SUPPORT_CHAT_ID, '只有 owner 可以修改控制台开关。', thread); return; }
    await handleControlCommand(env, message, arg, rest);
    return;
  }

  const readOnlyAllowed = new Set(['/setup', '/id', '/info', '/contact', '/panel', '/workbench', '/users', '/recent', '/pending', '/check', '/help']);
  if (role === 'readonly' && !readOnlyAllowed.has(cmd)) {
    await sendMessage(env, env.SUPPORT_CHAT_ID, 'readonly 只能查看，不能执行写操作。', thread);
    return;
  }

  if (cmd === '/note' && target) {
    const note = arg && /^-?\d+$/.test(arg) ? rest.join(' ') : [arg, ...rest].filter(Boolean).join(' ');
    await applyUserAction(env, target, 'note', note);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `已备注 <code>${html(target)}</code>：${html(note || '空')}`, thread);
    return;
  }

  if ((cmd === '/close' || cmd === '/open') && target) {
    const status = cmd === '/close' ? 'closed' : 'open';
    await applyUserAction(env, target, status === 'closed' ? 'close' : 'open');
    await refreshUserPresentation(env, target);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `会话状态已改为：<b>${html(status)}</b>`, thread);
    return;
  }

  if ((cmd === '/mute' || cmd === '/unmute') && target) {
    await applyUserAction(env, target, cmd === '/mute' ? 'mute' : 'unmute');
    await refreshUserPresentation(env, target);
    await sendMessage(env, env.SUPPORT_CHAT_ID, cmd === '/mute' ? '已静音该用户提醒' : '已恢复该用户提醒', thread);
    return;
  }

  if ((cmd === '/pin' || cmd === '/unpin') && target) {
    await applyUserAction(env, target, cmd === '/pin' ? 'pin' : 'unpin');
    await refreshUserPresentation(env, target);
    await sendMessage(env, env.SUPPORT_CHAT_ID, cmd === '/pin' ? '已标记为重要用户' : '已取消重要用户标记', thread);
    return;
  }

  if (cmd === '/quick') {
    await handleQuickCommand(env, message, arg, rest);
    return;
  }

  if (cmd === '/kw' || cmd === '/keyword') {
    await handleKeywordCommand(env, message, arg, rest);
    return;
  }

  if (cmd === '/tag' && target) {
    const tag = arg && /^-?\d+$/.test(arg) ? rest[0] : arg;
    if (!tag) {
      const row = await getUserByChatId(env.DB, target, env);
      await sendMessage(env, env.SUPPORT_CHAT_ID, `当前标签：${html(row?.tags || '无')}`, thread);
      return;
    }
    await applyUserAction(env, target, 'tag_add', tag);
    const rowAfterTag = await getUserByChatId(env.DB, target, env);
    const tags = (rowAfterTag?.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `已添加标签：${html(tags.join(', ') || '无')}`, thread);
    return;
  }

  if (cmd === '/untag' && target) {
    const tag = arg && /^-?\d+$/.test(arg) ? rest[0] : arg;
    if (!tag) return;
    await applyUserAction(env, target, 'tag_remove', tag);
    const rowAfterTag = await getUserByChatId(env.DB, target, env);
    const tags = (rowAfterTag?.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `已更新标签：${html(tags.join(', ') || '无')}`, thread);
    return;
  }

  if (cmd === '/ai' || cmd === '/ai_on' || cmd === '/ai_off') {
    await sendMessage(env, env.SUPPORT_CHAT_ID, 'AI 功能当前已隐藏，如需使用请在 Web 后台设置页管理。', thread);
    return;
  }

  if (cmd === '/ai_model') {
    if (role === 'readonly' && arg !== 'list') { await sendMessage(env, env.SUPPORT_CHAT_ID, 'readonly 只能查看 AI 模型。', thread); return; }
    await handleAiModelCommand(env, message, arg, rest);
    return;
  }

  if (cmd === '/ai_auto') {
    const normalizedArg = normalizeSubcommand(arg);
    if (normalizedArg === 'on' && role !== 'owner') { await sendMessage(env, env.SUPPORT_CHAT_ID, '只有 owner 可以开启全局 AI 自动回复。', thread); return; }
    if (role === 'readonly') { await sendMessage(env, env.SUPPORT_CHAT_ID, 'readonly 不能修改全局 AI 自动回复。', thread); return; }
    const value = normalizedArg === 'on' ? 'true' : normalizedArg === 'off' ? 'false' : undefined;
    if (!value) {
      await sendMessage(env, env.SUPPORT_CHAT_ID, '用法：/全局AI 开启/关闭，或 /ai_auto on/off', thread);
      return;
    }
    await updateSetting(env, 'ai_auto_reply', value);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `全局 AI 自动回复已${value === 'true' ? '开启' : '关闭'}。更推荐用 /ai_on 给单个用户开启。`, thread);
    return;
  }

  if (cmd === '/welcome') {
    if (role === 'readonly') { await sendMessage(env, env.SUPPORT_CHAT_ID, 'readonly 只能查看欢迎语，不能修改。', thread); return; }
    const sub = normalizeSubcommand(arg);
    const value = rest.join(' ').trim();
    if (!arg || sub === 'show' || sub === 'view' || sub === '查看') {
      const current = (await getSetting(env.DB, 'welcome_message', env)) ?? '';
      await markPendingWelcomeInput(env, message);
      await sendMessage(env, env.SUPPORT_CHAT_ID, `📝 <b>欢迎语设置</b>\n\n当前欢迎语：\n${current ? html(current) : '<i>未设置</i>'}\n\n现在发送<b>下一条非命令文本</b>，就会保存为新的欢迎语；保存成功后会自动退出输入状态。\n支持多行，5 分钟内有效。\n取消：<code>/welcome cancel</code>\n清空：<code>/welcome clear</code>`, {
        ...thread,
        reply_markup: { force_reply: true, selective: true, input_field_placeholder: '输入新的欢迎语，支持多行' },
      });
    } else if (sub === 'cancel' || sub === '取消') {
      await setSetting(env.DB, pendingWelcomeKey(message), '', env);
      await sendMessage(env, env.SUPPORT_CHAT_ID, '已取消本次欢迎语输入。', thread);
    } else if (sub === 'clear' || sub === 'off' || sub === '关闭' || sub === '清空') {
      await updateSetting(env, 'welcome_message', '');
      await sendMessage(env, env.SUPPORT_CHAT_ID, '欢迎语已清空；新用户首次进来不会自动收到欢迎语。', thread);
    } else if (sub === 'set' || sub === '设置') {
      if (!value) { await sendMessage(env, env.SUPPORT_CHAT_ID, '用法：/welcome set 欢迎语内容', thread); return; }
      await updateSetting(env, 'welcome_message', value);
      await sendMessage(env, env.SUPPORT_CHAT_ID, `欢迎语已更新：\n${html(value)}`, thread);
    } else {
      const legacyValue = [arg, ...rest].filter(Boolean).join(' ');
      await updateSetting(env, 'welcome_message', legacyValue);
      await sendMessage(env, env.SUPPORT_CHAT_ID, `欢迎语已更新：\n${html(legacyValue)}`, thread);
    }
    return;
  }

  if (cmd === '/block' && target) {
    await applyUserAction(env, target, 'block', rest.join(' ') || undefined);
    await refreshUserPresentation(env, target);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `已拉黑 <code>${html(target)}</code>`, thread);
    return;
  }

  if (cmd === '/unblock' && target) {
    await applyUserAction(env, target, 'unblock');
    await refreshUserPresentation(env, target);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `已解除拉黑 <code>${html(target)}</code>`, thread);
    return;
  }

  if (cmd === '/help') {
    await sendMessage(env, env.SUPPORT_CHAT_ID, supportHelp(), thread);
  }
}

async function handleControlCommand(env: Env, message: TelegramMessage, arg: string | undefined, rest: string[]): Promise<void> {
  const thread = { message_thread_id: message.message_thread_id };
  const keyMap: Record<string, string> = {
    pending: 'pending_tracking_enabled',
    待跟进: 'pending_tracking_enabled',
    panel: 'support_message_panel_enabled',
    消息按钮: 'support_message_panel_enabled',
    topic_delete: 'support_topic_delete_mode',
    删除话题: 'support_topic_delete_mode',
    digest: 'support_notification_mode',
    摘要: 'support_notification_mode',
  };
  const normalizedArg = normalizeSubcommand(arg);
  if (!normalizedArg || normalizedArg === 'show' || normalizedArg === '查看') {
    await sendMessage(env, env.SUPPORT_CHAT_ID, await controlPanelText(env), { ...thread, reply_markup: await controlPanelKeyboard(env) });
    return;
  }
  const key = keyMap[normalizedArg];
  const value = normalizeSubcommand(rest[0]);
  if (!key || !value) {
    await sendMessage(env, env.SUPPORT_CHAT_ID, '用法：/control pending off|on，/control panel off|on，/control topic_delete notify|close|delete\n/control digest on|off', thread);
    return;
  }
  let stored = value;
  if (value === 'on' || value === '开启') stored = key === 'support_notification_mode' ? 'digest' : 'true';
  if (value === 'off' || value === '关闭') stored = key === 'support_notification_mode' ? 'off' : 'false';
  await updateSetting(env, key, stored);
  await sendMessage(env, env.SUPPORT_CHAT_ID, `已更新：${key} = ${stored}`, thread);
}

async function handleQuickCommand(env: Env, message: TelegramMessage, arg: string | undefined, rest: string[]): Promise<void> {
  arg = normalizeSubcommand(arg);
  const thread = { message_thread_id: message.message_thread_id };
  const target = await resolveTargetUser(env, message);

  if (!arg || arg === 'list') {
    const rows = await listQuickReplies(env.DB, env);
    const body = rows.length ? rows.map((x) => `/${html(x.key)}：${html(x.text).slice(0, 120)}`).join('\n') : '暂无快捷回复。';
    await sendMessage(env, env.SUPPORT_CHAT_ID, `<b>快捷回复</b>\n${body}\n\n用法：/quick key 发送；/quick set key 内容`, thread);
    return;
  }

  if (arg === 'set') {
    const [key, ...textParts] = rest;
    const value = textParts.join(' ').trim();
    if (!key || !value) {
      await sendMessage(env, env.SUPPORT_CHAT_ID, '用法：/quick set price 这里写回复内容', thread);
      return;
    }
    await saveQuick(env, key, value);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `快捷回复 <code>${html(key)}</code> 已保存。`, thread);
    return;
  }

  const quick = await getQuickReply(env.DB, arg, env);
  if (!quick) {
    await sendMessage(env, env.SUPPORT_CHAT_ID, `没有找到快捷回复 <code>${html(arg)}</code>，用 /quick list 查看。`, thread);
    return;
  }

  if (!target) {
    await sendMessage(env, env.SUPPORT_CHAT_ID, '当前不在用户 Topic 里，找不到发送对象。', thread);
    return;
  }

  await sendMessage(env, target, quick.text);
  await logMessage(env.DB, target, 'out', message.message_id, quick.text, env);
  await sendMessage(env, env.SUPPORT_CHAT_ID, `已发送快捷回复 <code>${html(arg)}</code>。`, thread);
}

async function handleKeywordCommand(env: Env, message: TelegramMessage, arg: string | undefined, rest: string[]): Promise<void> {
  arg = normalizeSubcommand(arg);
  const thread = { message_thread_id: message.message_thread_id };

  if (!arg || arg === 'list') {
    const rows = await listKeywordReplies(env.DB, env);
    const body = rows.length ? rows.map((x) => `${x.enabled ? '✅' : '⛔'} <code>${html(x.keyword)}</code> → ${html(x.reply).slice(0, 120)}`).join('\n') : '暂无关键词自动回复。';
    await sendMessage(env, env.SUPPORT_CHAT_ID, `<b>关键词自动回复</b>\n${body}\n\n用法：/kw set 关键词 回复内容；/kw del 关键词`, thread);
    return;
  }

  if (arg === 'set') {
    const [keyword, ...replyParts] = rest;
    const reply = replyParts.join(' ').trim();
    if (!keyword || !reply) {
      await sendMessage(env, env.SUPPORT_CHAT_ID, '用法：/kw set 价格 这里写自动回复内容', thread);
      return;
    }
    await saveKeyword(env, keyword, reply);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `关键词 <code>${html(keyword)}</code> 已保存。`, thread);
    return;
  }

  if (arg === 'del') {
    const keyword = rest[0];
    if (!keyword) return;
    await removeKeyword(env, keyword);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `关键词 <code>${html(keyword)}</code> 已删除。`, thread);
  }
}


async function handleAiModelCommand(env: Env, message: TelegramMessage, arg: string | undefined, rest: string[]): Promise<void> {
  arg = normalizeSubcommand(arg);
  const thread = { message_thread_id: message.message_thread_id };
  if (!arg || arg === 'list') {
    const rows = await listAiModelConfigs(env);
    const body = rows.length ? rows.map((x) => `${x.is_default ? '✅' : '▫️'} <code>${html(x.id)}</code> ${html(x.name)} — ${html(x.model)}${x.enabled ? '' : '（停用）'}`).join('\n') : '暂无 AI 模型。';
    await sendMessage(env, env.SUPPORT_CHAT_ID, `<b>AI 模型</b>\n${body}\n\n用法：/ai_model use/on/off/del ID`, thread);
    return;
  }
  const id = rest[0];
  if (!id) {
    await sendMessage(env, env.SUPPORT_CHAT_ID, '用法：/ai_model list 或 /ai_model use/on/off/del ID', thread);
    return;
  }
  if (arg === 'use') {
    await useAiModel(env, id);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `默认 AI 模型已切换为 <code>${html(id)}</code>`, thread);
    return;
  }
  if (arg === 'on' || arg === 'off') {
    await toggleAiModel(env, id, arg === 'on');
    await sendMessage(env, env.SUPPORT_CHAT_ID, `AI 模型 <code>${html(id)}</code> 已${arg === 'on' ? '启用' : '停用'}。`, thread);
    return;
  }
  if (arg === 'del') {
    await removeAiModel(env, id);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `AI 模型 <code>${html(id)}</code> 已删除。`, thread);
  }
}

async function handleAiCommand(env: Env, message: TelegramMessage, target: string, extraPrompt: string): Promise<void> {
  const thread = { message_thread_id: message.message_thread_id };
  try {
    const draft = await draftReply(env, target, extraPrompt || message.reply_to_message?.text || undefined);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `🤖 <b>AI 回复草稿</b>\n\n${html(draft)}\n\n如果要发送，直接复制这段发到当前 Topic。`, thread);
  } catch (err) {
    await sendMessage(env, env.SUPPORT_CHAT_ID, `AI 生成失败：${html(err instanceof Error ? err.message : String(err))}`, thread);
  }
}

async function handleAdminCommand(env: Env, message: TelegramMessage, arg: string | undefined, rest: string[]): Promise<void> {
  arg = normalizeSubcommand(arg);
  const thread = { message_thread_id: message.message_thread_id };
  if (arg === 'add' || arg === 'set') {
    const userId = rest[0];
    if (!userId) return;
    const role = ['owner', 'admin', 'readonly'].includes(rest[1] ?? '') ? rest[1] : 'admin';
    const name = role === 'admin' ? rest.slice(1).join(' ') : rest.slice(2).join(' ');
    await addAdmin(env.DB, userId, name || undefined, role as 'owner' | 'admin' | 'readonly');
    await sendMessage(env, env.SUPPORT_CHAT_ID, `已添加管理员 <code>${html(userId)}</code>`, thread);
    return;
  }
  if (arg === 'del') {
    const userId = rest[0];
    if (!userId) return;
    await removeAdmin(env.DB, userId);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `已删除管理员 <code>${html(userId)}</code>`, thread);
    return;
  }
  const admins = await listAdmins(env.DB);
  const envAdmins = [...parseOwnerIds(env.OWNER_IDS)].map((x) => `<code>${html(x)}</code>（环境变量）`);
  const dbAdmins = admins.map((x) => `<code>${html(x.user_id)}</code> <b>${html(x.role)}</b>${x.name ? ` ${html(x.name)}` : ''}`);
  await sendMessage(env, env.SUPPORT_CHAT_ID, `<b>管理员列表</b>\n${[...envAdmins, ...dbAdmins].join('\n') || '暂无'}`, thread);
}

async function handleUsersCommand(env: Env, message: TelegramMessage, filter?: string): Promise<void> {
  const rows = await listUsers(env.DB, filter, 20, env);
  await sendMessage(env, env.SUPPORT_CHAT_ID, formatUserList('用户列表', rows), { message_thread_id: message.message_thread_id });
}

async function sendWorkbench(env: Env, message: TelegramMessage): Promise<void> {
  const [summary, stats] = await Promise.all([getSupportWorkbench(env), getWorkbenchStats(env)]);
  await sendMessage(env, env.SUPPORT_CHAT_ID, workbenchText(summary, stats), {
    message_thread_id: message.message_thread_id,
    reply_markup: workbenchKeyboard(),
  });
}

async function handleQueueCommand(env: Env, message: TelegramMessage, kind: 'pending' | 'important' | 'overdue' | 'recent'): Promise<void> {
  const panel = await getSupportQueue(env, kind, 10);
  await sendMessage(env, env.SUPPORT_CHAT_ID, queueText(env, panel), {
    message_thread_id: message.message_thread_id,
    reply_markup: queueKeyboard(env, panel),
  });
}

async function handleBroadcastCommand(env: Env, message: TelegramMessage, arg: string | undefined, rest: string[]): Promise<void> {
  const parts = [arg, ...rest].filter((part): part is string => Boolean(part));
  let tag: string | undefined;
  const textParts: string[] = [];
  for (const part of parts) {
    if (part.startsWith('tag:') && !tag) tag = part.slice(4);
    else textParts.push(part);
  }
  const text = textParts.join(' ').trim();
  if (!text) {
    await sendMessage(env, env.SUPPORT_CHAT_ID, '用法：/broadcast [tag:标签] 要群发的内容\n然后用 /confirm_broadcast 广播ID 二次确认。', { message_thread_id: message.message_thread_id });
    return;
  }
  const draft = await createBroadcastDraft(env, text, message.from ? String(message.from.id) : undefined, tag ? { type: 'tag', value: tag } : { type: 'all' });
  await sendMessage(env, env.SUPPORT_CHAT_ID, `⚠️ 广播草稿已创建\nID: <code>${html(draft.id)}</code>\n筛选：<b>${html(draft.filter)}</b>\n目标用户数：<b>${draft.targetCount}</b>\n\n内容：\n${html(text)}\n\n确认发送：/confirm_broadcast ${html(draft.id)}`, { message_thread_id: message.message_thread_id });
}

async function confirmBroadcast(env: Env, message: TelegramMessage, id?: string): Promise<void> {
  if (!id) return;
  try {
    const result = await sendBroadcastDraft(env, id);
    await sendMessage(env, env.SUPPORT_CHAT_ID, `广播完成：成功 ${result.ok}，失败 ${result.failed}`, { message_thread_id: message.message_thread_id });
  } catch {
    await sendMessage(env, env.SUPPORT_CHAT_ID, '广播草稿不存在或已发送。', { message_thread_id: message.message_thread_id });
  }
}

async function handleCheck(env: Env, message: TelegramMessage): Promise<void> {
  const checks = [
    `SUPPORT_CHAT_ID: ${env.SUPPORT_CHAT_ID ? '✅' : '❌ 未配置'}`,
    `DB: ${env.DB ? '✅' : '❌ 未绑定'}`,
    `KV: ${env.KV ? '✅' : '⚠️ 未绑定，防刷不可用'}`,
    `当前群 Topics: ${message.chat.is_forum ? '✅' : '⚠️ 未开启/未知'}`,
    `当前群 ID: <code>${html(message.chat.id)}</code>`,
  ];
  await sendMessage(env, env.SUPPORT_CHAT_ID, `<b>部署自检</b>\n${checks.join('\n')}`, { message_thread_id: message.message_thread_id });
}

async function handleSetupHint(env: Env, message: TelegramMessage): Promise<void> {
  if (message.chat.type === 'private') return;
  const thread = { message_thread_id: message.message_thread_id };
  if (!env.SUPPORT_CHAT_ID) {
    try {
      const bot = await bindCurrentBotSupportGroup(env, {
        supportChatId: String(message.chat.id),
        actorUserId: message.from?.id,
        isForum: message.chat.is_forum,
        title: message.chat.title,
      });
      await sendMessage(env, message.chat.id, `✅ 已绑定这个群为 <b>${html(bot.name)}</b> 的后台群。\n\n以后客户私聊这个 Bot，会进入本群的独立 Topic。`, thread);
      return;
    } catch (err) {
      await sendMessage(env, message.chat.id, `绑定失败：${html(err instanceof Error ? err.message : String(err))}`, thread);
      return;
    }
  }

  const isForum = message.chat.is_forum ? '是' : '否/未知';
  const text = [
    '🧰 <b>后台群设置助手</b>',
    `当前群 ID：<code>${html(message.chat.id)}</code>`,
    `是否开启 Topics：<b>${html(isForum)}</b>`,
    `你的管理员 ID：<code>${html(message.from?.id ?? '')}</code>`,
    '',
    env.SUPPORT_CHAT_ID === String(message.chat.id)
      ? '这个群已经是当前 Bot 的后台群。'
      : '这个 Bot 已经绑定过后台群；如需更换，请在后台高级配置里处理。',
    '',
    '如果 Topics 不是“是”：请在群设置里开启“话题/Topics”，并把 bot 设为管理员。',
  ].join('\n');

  await sendMessage(env, message.chat.id, text, thread);
}

async function isRateLimited(env: Env, userChatId: string): Promise<boolean> {
  if (!env.KV) return false;
  const limit = Number(env.RATE_LIMIT_COUNT ?? (await getSetting(env.DB, 'rate_limit_count', env)) ?? 8);
  const windowSeconds = Number(env.RATE_LIMIT_WINDOW_SECONDS ?? (await getSetting(env.DB, 'rate_limit_window_seconds', env)) ?? 60);
  if (!limit || !windowSeconds) return false;

  const key = `rl:${userChatId}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
  const current = Number((await env.KV.get(key)) ?? 0) + 1;
  await env.KV.put(key, String(current), { expirationTtl: windowSeconds + 10 });
  return current > limit;
}

async function getSupportAdminRole(env: Env, userId: number): Promise<'owner' | 'admin' | 'readonly' | null> {
  const id = String(userId);
  const ownerIds = parseOwnerIds(env.OWNER_IDS);
  if (!ownerIds.size) return 'owner';
  if (ownerIds.has(id)) return 'owner';
  const admins = await listAdmins(env.DB);
  return admins.find((x) => x.user_id === id)?.role ?? null;
}

async function isAllowedAdmin(env: Env, userId: number): Promise<boolean> {
  return Boolean(await getSupportAdminRole(env, userId));
}

function stripBotName(cmd: string): string {
  return cmd.split('@')[0];
}

function isBindCommand(text?: string): boolean {
  const first = text?.trim().split(/\s+/)[0];
  if (!first) return false;
  return normalizeSupportCommand(stripBotName(first)) === '/bind';
}

function normalizeSupportCommand(cmd: string): string {
  const map: Record<string, string> = {
    '/帮助': '/help',
    '/控制台': '/control',
    '/设置面板': '/control',
    '/设置': '/setup',
    '/初始化': '/setup',
    '/绑定': '/bind',
    '/bind': '/bind',
    '/群id': '/id',
    '/群ID': '/id',
    '/id': '/id',
    '/资料': '/info',
    '/信息': '/info',
    '/用户': '/info',
    '/联系': '/contact',
    '/面板': '/panel',
    '/按钮': '/panel',
    '/操作': '/panel',
    '/工作台': '/workbench',
    '/总控台': '/workbench',
    '/管理员': '/admin',
    '/用户列表': '/users',
    '/最近': '/recent',
    '/待处理': '/pending',
    '/广播': '/broadcast',
    '/确认广播': '/confirm_broadcast',
    '/自检': '/check',
    '/检查': '/check',
    '/备注': '/note',
    '/关闭': '/close',
    '/打开': '/open',
    '/重开': '/open',
    '/静音': '/mute',
    '/取消静音': '/unmute',
    '/重要': '/pin',
    '/取消重要': '/unpin',
    '/快捷': '/quick',
    '/快捷回复': '/quick',
    '/关键词': '/kw',
    '/标签': '/tag',
    '/删标签': '/untag',
    '/ai': '/ai',
    '/AI': '/ai',
    '/AI开启': '/ai_on',
    '/AI关闭': '/ai_off',
    '/ai开启': '/ai_on',
    '/ai关闭': '/ai_off',
    '/模型': '/ai_model',
    '/全局AI': '/ai_auto',
    '/欢迎语': '/welcome',
    '/拉黑': '/block',
    '/解除拉黑': '/unblock',
  };
  return map[cmd] ?? cmd;
}

function normalizeSubcommand(value?: string): string | undefined {
  const map: Record<string, string> = {
    '列表': 'list',
    '查看': 'list',
    '新增': 'set',
    '设置': 'set',
    '保存': 'set',
    '删除': 'del',
    '删': 'del',
    '使用': 'use',
    '启用': 'on',
    '停用': 'off',
    '开启': 'on',
    '关闭': 'off',
  };
  return value ? (map[value] ?? value) : value;
}

function formatUserList(title: string, rows: UserRow[]): string {
  if (!rows.length) return `<b>${html(title)}</b>\n暂无`;
  return [
    `<b>${html(title)}</b>`,
    ...rows.map((row) => {
      const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.username || row.user_chat_id;
      const username = row.username ? ` @${row.username}` : '';
      const flags = [row.pending ? '待处理' : '', row.tags || '', row.important ? '⭐' : ''].filter(Boolean).join(' / ');
      return `• <code>${html(row.user_chat_id)}</code> ${html(name)}${html(username)} ${flags ? `— ${html(flags)}` : ''}`;
    }),
  ].join('\n');
}

function contactInfo(row: UserRow): string {
  const username = row.username ? `@${row.username}` : '无公开 username';
  const tgLink = row.username ? `https://t.me/${row.username}` : `tg://user?id=${row.user_chat_id}`;
  return [
    '<b>联系信息</b>',
    `用户 ID: <code>${html(row.user_chat_id)}</code>`,
    `公开用户名: ${html(username)}`,
    `打开链接: ${html(tgLink)}`,
    '',
    '说明：Telegram bot 只能拿到用户公开 username/姓名/数字 ID。对方没设置 username 时，不能通过 bot 强行拿手机号或自动加好友，只能用 ID 识别会话。',
  ].join('\n');
}

function userInfo(row: UserRow): string {
  const lines = [
    '<b>用户资料</b>',
    `ID: <code>${html(row.user_chat_id)}</code>`,
    `昵称: ${html([row.first_name, row.last_name].filter(Boolean).join(' ') || row.username || '')}`,
    row.username ? `用户名: @${html(row.username)}` : '',
    `Topic: <code>${html(row.topic_id ?? '')}</code>`,
    `状态: <b>${html(row.status ?? 'open')}</b>`,
    `待处理: ${row.pending ? '是' : '否'}`,
    `AI模式: ${html(row.ai_mode ?? 'manual')}`,
    `拉黑: ${row.is_blocked ? '是' : '否'}`,
    `重要: ${row.important ? '是' : '否'}`,
    `静音: ${row.muted ? '是' : '否'}`,
    row.note ? `备注: ${html(row.note)}` : '备注: 无',
    row.tags ? `标签: ${html(row.tags)}` : '标签: 无',
  ].filter(Boolean);
  return lines.join('\n');
}

function topicTitle(user: TelegramUser): string {
  const name = displayName(user);
  const uname = user.username ? ` @${user.username}` : '';
  return `${name}${uname} (${user.id})`.slice(0, 128);
}

function displayName(user: TelegramUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || user.username || String(user.id);
}

function userCard(user: TelegramUser): string {
  const lines = [
    '🆕 <b>用户会话</b>',
    `ID: <code>${html(user.id)}</code>`,
    `昵称: ${html(displayName(user))}`,
  ];
  if (user.username) lines.push(`用户名: @${html(user.username)}`);
  if (user.language_code) lines.push(`语言: ${html(user.language_code)}`);
  lines.push('', '常用命令：/info /note 备注 /quick list /close /block');
  return lines.join('\n');
}

function isCommand(text: string | undefined, command: string): boolean {
  if (!text) return false;
  return text === command || text.startsWith(`${command}@`);
}

function parseOwnerIds(raw?: string): Set<string> {
  return new Set((raw ?? '').split(',').map((x) => x.trim()).filter(Boolean));
}

function supportHelp(): string {
  return [
    '<b>双向客服 Bot 后台群命令</b>',
    '',
    '<b>最常用</b>',
    '直接在用户 Topic 里发消息：回复给用户',
    '/帮助：显示这份帮助',
    '/资料：查看当前用户资料',
    '/联系：查看用户 ID、username、t.me 链接',
    '/面板：重新发送/刷新当前用户的按钮操作面板',
    '/工作台：打开客服队列总控台',
    '/备注 备注内容：给当前用户写备注',
    '/关闭：关闭当前会话',
    '/打开：重新打开当前会话',
    '/拉黑 [原因]：拉黑当前用户',
    '/解除拉黑：解除拉黑当前用户',
    '',
    '<b>后台群配置</b>',
    '/设置：显示当前群 ID、管理员 ID、Topics 状态',
    '/群id：查看当前群和 Topic ID',
    '/自检：部署自检',
    '',
    '<b>用户管理</b>',
    '/用户列表 [关键词/标签]：查看用户列表',
    '/最近：查看最近用户',
    '/待处理：查看待处理用户',
    '/标签 标签名：给当前用户加标签',
    '/删标签 标签名：移除当前用户标签',
    '/静音 /取消静音：静音或恢复提醒',
    '/重要 /取消重要：标记或取消重要用户',
    '',
    '<b>快捷回复 / 关键词</b>',
    '/快捷 列表：查看快捷回复',
    '/快捷 key：发送快捷回复',
    '/快捷 设置 key 内容：新增/更新快捷回复',
    '/关键词 列表：查看关键词自动回复',
    '/关键词 设置 关键词 回复内容：新增/更新关键词',
    '/关键词 删除 关键词：删除关键词',
    '',
    '<b>广播 / 管理员</b>',
    '/广播 内容：创建广播草稿',
    '/确认广播 ID：二次确认发送广播',
    '/管理员：查看管理员列表',
    '/管理员 新增 用户ID admin|readonly|owner 名字：添加管理员',
    '/管理员 删除 用户ID：删除管理员',
    '',
    '<b>英文命令也兼容</b>',
    '/help /setup /info /note /quick /kw /broadcast 等仍然可用。',
  ].join('\n');
}
