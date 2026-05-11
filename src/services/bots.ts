import { bindBotSupportChat, deleteBot, getBotByBindCode, getSetting, listBots, upsertBot } from '../db';
import { encryptSecret, maskSecret } from '../crypto';
import { DEFAULT_WORKSPACE_ID, webhookPathForBot } from '../tenant';
import { html as escapeHtml, sendMessage, setMyCommands, setWebhook } from '../telegram';
import type { BotRow, Env } from '../types';

export async function getBotPanel(env: Env) {
  return { bots: await listBots(env.DB, env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID) };
}

export async function saveBot(env: Env, input: {
  id: string;
  name: string;
  token?: string;
  webhookSecret?: string;
  publicUrl?: string;
  supportChatId?: string;
  enabled: boolean;
  isDefault: boolean;
}): Promise<string> {
  const id = normalizeId(input.id || generateBotId(input.name));
  const token = input.token?.trim() || '';
  const publicUrl = normalizeOptionalPublicUrl(input.publicUrl ?? '');
  const supportChatId = (input.supportChatId ?? '').trim();
  const webhookSecret = (input.webhookSecret ?? '').trim();
  if (!input.name.trim()) throw new Error('Bot 名称不能为空');
  if (token && !/^\d{6,}:[\w-]{20,}$/.test(token)) throw new Error('Bot Token 格式不正确');
  if (webhookSecret && webhookSecret.length < 16) throw new Error('Webhook Secret 建议至少 16 位');
  if (supportChatId && !/^-100\d+/.test(supportChatId)) throw new Error('后台群 ID 应为 -100 开头');
  await upsertBot(env.DB, {
    id,
    workspace_id: env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID,
    name: input.name.trim(),
    token_encrypted: token ? await encryptSecret(env, token) : null,
    token_hint: token ? maskSecret(token) : null,
    webhook_secret: webhookSecret || null,
    public_url: publicUrl || null,
    support_chat_id: supportChatId || null,
    bind_code: supportChatId ? null : generateBindCode(),
    bind_code_expires_at: supportChatId ? null : bindCodeExpiry(),
    enabled: input.enabled ? 1 : 0,
    is_default: input.isDefault ? 1 : 0,
  });
  return id;
}

export async function quickActivateBot(env: Env, input: { name: string; token: string; supportChatId?: string; publicUrl?: string; isDefault?: boolean }): Promise<{ id: string; webhookUrl: string | null; bindCode: string | null; bindCommand: string | null; missingSupportChatId: boolean }> {
  const publicUrl = normalizeOptionalPublicUrl(input.publicUrl?.trim() || env.PUBLIC_URL || await getSetting(env.DB, 'public_url') || '');
  const supportChatId = input.supportChatId?.trim() || '';
  const webhookSecret = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().slice(0, 8);
  const token = input.token?.trim() || '';
  const id = await saveBot(env, {
    id: '',
    name: input.name,
    token,
    webhookSecret,
    publicUrl,
    supportChatId,
    enabled: true,
    isDefault: Boolean(input.isDefault),
  });
  const bot = (await listBots(env.DB, env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID)).find((x) => x.id === id);
  const webhookUrl = publicUrl ? webhookPathForBot(publicUrl, id) : null;
  const botEnv = { ...env, BOT_TOKEN: token, WEBHOOK_SECRET: webhookSecret };
  if (webhookUrl && token) {
    await setWebhook(botEnv, webhookUrl, webhookSecret);
    await setMyCommands(botEnv);
  }
  if (supportChatId && token) {
    await sendMessage(botEnv, supportChatId, `✅ Bot 已激活：<b>${escapeHtml(input.name.trim())}</b>\n\nWebhook 已安装，用户私聊这个 Bot 后，会在本群自动创建对应 Topic。\n\n如果还没生效，请确认：本群已开启 Topics，且 Bot 是管理员。`);
  }
  const bindCode = supportChatId ? null : bot?.bind_code ?? null;
  return { id, webhookUrl, bindCode, bindCommand: bindCode ? `/bind ${bindCode}` : null, missingSupportChatId: !supportChatId };
}

export async function bindBotSupportGroup(env: Env, input: { code: string; supportChatId: string; actorUserId?: number; isForum?: boolean; title?: string }): Promise<BotRow> {
  assertForumSupportChat(input);
  const code = normalizeBindCode(input.code);
  const bot = await getBotByBindCode(env.DB, code);
  if (!bot) throw new Error('绑定码无效或已使用');
  if (bot.bind_code_expires_at && Date.parse(bot.bind_code_expires_at) < Date.now()) throw new Error('绑定码已过期，请在后台重新生成');
  return bindSupportChat(bot, env, input.supportChatId);
}

export async function bindCurrentBotSupportGroup(env: Env, input: { supportChatId: string; actorUserId?: number; isForum?: boolean; title?: string }): Promise<BotRow> {
  assertForumSupportChat(input);
  const workspaceId = env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID;
  const botId = env.BOT_ID || 'default';
  const bot = (await listBots(env.DB, workspaceId)).find((x) => x.id === botId);
  if (!bot) throw new Error('Bot 不存在或已停用');
  if (bot.support_chat_id) throw new Error('这个 Bot 已经绑定过后台群，如需更换请在后台高级配置里处理');
  return bindSupportChat(bot, env, input.supportChatId);
}

function assertForumSupportChat(input: { supportChatId: string; isForum?: boolean }): void {
  if (!/^-100\d+/.test(input.supportChatId)) throw new Error('请在 Telegram 超级群 / Forum 群里发送绑定命令');
  if (!input.isForum) throw new Error('后台群必须开启“话题 / Topics”。请在群设置里开启话题后再绑定。');
}

async function bindSupportChat(bot: BotRow, env: Env, supportChatId: string): Promise<BotRow> {
  if (!/^-100\d+/.test(supportChatId)) throw new Error('请在 Telegram 超级群 / Forum 群里发送绑定命令');
  await bindBotSupportChat(env.DB, { workspaceId: bot.workspace_id, botId: bot.id, supportChatId });
  return { ...bot, support_chat_id: supportChatId, bind_code: null, bind_code_expires_at: null };
}

export async function removeBot(env: Env, id: string): Promise<void> {
  id = normalizeId(id);
  if (id === 'default') throw new Error('默认 Bot 不能删除');
  await deleteBot(env.DB, id, env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID);
}

export function botWebhookUrl(publicUrl: string | null | undefined, id: string): string {
  return publicUrl ? webhookPathForBot(publicUrl, id) : '';
}

function normalizeId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,48}$/.test(id)) throw new Error('Bot ID 只能用小写字母、数字、下划线、短横线，长度 2-49');
  return id;
}

function generateBotId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const prefix = /^[a-z0-9][a-z0-9_-]{1,}$/.test(base) ? base : 'bot';
  return `${prefix}-${crypto.randomUUID().slice(0, 6)}`;
}

function generateBindCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `TG-${Array.from(bytes, (byte) => chars[byte % chars.length]).join('')}`;
}

function bindCodeExpiry(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function normalizeBindCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^TG-[A-Z0-9]{4,12}$/.test(code)) throw new Error('绑定码格式不正确');
  return code;
}

function normalizeOptionalPublicUrl(value: string): string {
  value = value.trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}
