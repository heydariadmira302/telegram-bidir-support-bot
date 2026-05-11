import { getSetting, getBotById, getDefaultBot, insertDefaultBotSettings } from './db';
import { decryptSecret, encryptSecret, maskSecret } from './crypto';
import type { BotConfig, BotRow, Env, TenantContext } from './types';

export const DEFAULT_WORKSPACE_ID = 'default';
export const DEFAULT_BOT_ID = 'default';

export function workspaceId(env?: Pick<Env, 'WORKSPACE_ID'> | null): string {
  return env?.WORKSPACE_ID || DEFAULT_WORKSPACE_ID;
}

export function botId(env?: Pick<Env, 'BOT_ID'> | null): string {
  return env?.BOT_ID || DEFAULT_BOT_ID;
}

export function withTenant(env: Env, ctx: TenantContext): Env {
  const isDefaultBot = ctx.botId === DEFAULT_BOT_ID;
  return {
    ...env,
    WORKSPACE_ID: ctx.workspaceId,
    BOT_ID: ctx.botId,
    BOT_TOKEN: ctx.bot.token || (isDefaultBot ? env.BOT_TOKEN : ''),
    WEBHOOK_SECRET: ctx.bot.webhook_secret || (isDefaultBot ? env.WEBHOOK_SECRET : undefined),
    SUPPORT_CHAT_ID: ctx.bot.support_chat_id || (isDefaultBot ? env.SUPPORT_CHAT_ID : ''),
    PUBLIC_URL: ctx.bot.public_url || env.PUBLIC_URL,
  };
}

export async function ensureDefaultBot(env: Env): Promise<void> {
  const token = env.BOT_TOKEN || await getSetting(env.DB, 'bot_token') || '';
  const tokenEncrypted = token ? await encryptSecret(env, token).catch(() => null) : null;
  await insertDefaultBotSettings(env.DB, {
    tokenEncrypted,
    tokenHint: token ? maskSecret(token) : null,
    webhookSecret: env.WEBHOOK_SECRET || await getSetting(env.DB, 'webhook_secret'),
    publicUrl: env.PUBLIC_URL || await getSetting(env.DB, 'public_url'),
    supportChatId: env.SUPPORT_CHAT_ID || await getSetting(env.DB, 'support_chat_id'),
  });
}

export async function resolveTenantByBotId(env: Env, requestedBotId?: string | null): Promise<TenantContext | null> {
  await ensureDefaultBot(env);
  const ws = workspaceId(env);
  const row = requestedBotId ? await getBotById(env.DB, requestedBotId, ws) : await getDefaultBot(env.DB, ws);
  if (!row || row.enabled !== 1) return null;
  const bot = await hydrateBotConfig(env, row);
  return { workspaceId: bot.workspace_id, botId: bot.id, bot };
}

export async function hydrateBotConfig(env: Env, row: BotRow): Promise<BotConfig> {
  let token = row.id === DEFAULT_BOT_ID ? env.BOT_TOKEN || undefined : undefined;
  if (row.token_encrypted) token = await decryptSecret(env, row.token_encrypted);
  return { ...row, token };
}

export function webhookPathForBot(publicUrl: string, id: string): string {
  const base = publicUrl.replace(/\/$/, '');
  return id === DEFAULT_BOT_ID ? `${base}/telegram/webhook` : `${base}/telegram/webhook/${encodeURIComponent(id)}`;
}
