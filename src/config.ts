import { getSetting, setSetting } from './db';
import type { Env } from './types';

export const INSTALL_SETTING_KEYS = [
  'bot_token',
  'support_chat_id',
  'webhook_secret',
  'admin_password',
  'encryption_secret',
  'public_url',
  'owner_ids',
  'kb_enabled',
  'ai_api_key',
  'ai_base_url',
  'ai_model',
  'ai_system_prompt',
  'ai_auto_reply',
] as const;

export type InstallSettingKey = (typeof INSTALL_SETTING_KEYS)[number];

export async function isInstalled(env: Env): Promise<boolean> {
  if (!env.DB) return false;
  try {
    return (await getSetting(env.DB, 'initialized')) === 'true';
  } catch (err) {
    if (isMissingSettingsTableError(err)) return false;
    throw err;
  }
}

export function isMissingSettingsTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('no such table: settings') || message.includes('SQLITE_ERROR') && message.includes('settings');
}

export async function withRuntimeConfig(env: Env): Promise<Env> {
  const pairs = await Promise.all(INSTALL_SETTING_KEYS.map(async (key) => [key, await getSetting(env.DB, key)] as const));
  const settings = Object.fromEntries(pairs) as Partial<Record<InstallSettingKey, string | null>>;
  return {
    ...env,
    BOT_TOKEN: settings.bot_token || env.BOT_TOKEN,
    SUPPORT_CHAT_ID: settings.support_chat_id || env.SUPPORT_CHAT_ID,
    WEBHOOK_SECRET: settings.webhook_secret || env.WEBHOOK_SECRET,
    ADMIN_PASSWORD: settings.admin_password || env.ADMIN_PASSWORD,
    ENCRYPTION_SECRET: settings.encryption_secret || env.ENCRYPTION_SECRET,
    PUBLIC_URL: settings.public_url || env.PUBLIC_URL,
    OWNER_IDS: settings.owner_ids || env.OWNER_IDS,
    KB_ENABLED: settings.kb_enabled || env.KB_ENABLED,
    AI_API_KEY: settings.ai_api_key || env.AI_API_KEY,
    AI_BASE_URL: settings.ai_base_url || env.AI_BASE_URL,
    AI_MODEL: settings.ai_model || env.AI_MODEL,
    AI_SYSTEM_PROMPT: settings.ai_system_prompt || env.AI_SYSTEM_PROMPT,
    AI_AUTO_REPLY: settings.ai_auto_reply || env.AI_AUTO_REPLY,
  };
}

export async function saveInstallConfig(env: Env, config: Record<string, string>): Promise<void> {
  for (const key of INSTALL_SETTING_KEYS) {
    const value = (config[key] ?? '').trim();
    if (value || ['kb_enabled', 'ai_auto_reply', 'ai_api_key', 'ai_base_url', 'ai_model', 'ai_system_prompt'].includes(key)) {
      await setSetting(env.DB, key, value);
    }
  }
  await setSetting(env.DB, 'initialized', 'true');
}

export function normalizeInstallConfig(config: Record<string, string>): Record<string, string> {
  const next = { ...config };
  next.public_url = normalizePublicUrl(next.public_url || '');
  next.admin_password = next.admin_password || next.encryption_secret || crypto.randomUUID();
  next.kb_enabled = next.kb_enabled || 'false';
  next.ai_auto_reply = 'false';
  next.ai_api_key = '';
  next.ai_base_url = '';
  next.ai_model = '';
  next.ai_system_prompt = '';
  return next;
}

export function normalizePublicUrl(value: string): string {
  value = value.trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  return value.replace(/\/$/, '');
}

export function validateInstallConfig(config: Record<string, string>): string | null {
  const required = ['bot_token', 'webhook_secret', 'encryption_secret', 'public_url', 'owner_ids'];
  for (const key of required) {
    if (!config[key]?.trim()) return `${key} 不能为空`;
  }
  if (!/^\d{6,}:[\w-]{20,}$/.test(config.bot_token.trim())) return 'BOT_TOKEN 格式不正确';
  if (config.support_chat_id && !/^-100\d+/.test(config.support_chat_id.trim())) return 'SUPPORT_CHAT_ID 应为 -100 开头的后台 Forum 群 ID';
  if (config.webhook_secret.trim().length < 16) return 'WEBHOOK_SECRET 建议至少 16 位';
  if (config.encryption_secret.trim().length < 32) return 'ENCRYPTION_SECRET 至少 32 位';
  if (!/^https?:\/\//.test(config.public_url.trim())) return 'PUBLIC_URL 必须是 http:// 或 https:// 开头';
  if (!config.owner_ids.split(',').every((x) => /^\d+$/.test(x.trim()))) return 'OWNER_IDS 只能填写 Telegram 数字 ID，多个用英文逗号分隔';
  return null;
}
