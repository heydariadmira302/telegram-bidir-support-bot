import { getDefaultAiModel, getSetting, listAiModels } from '../db';
import { runSetupWizard } from './settings';
import type { Env } from '../types';

type CheckLevel = 'ok' | 'warn' | 'error';

export function getBackupInstructions() {
  return {
    warning: '后台只提供备份/恢复指引，不直接通过公网 Web 下载数据库，避免泄露用户数据。',
    node: 'sqlite3 data/telegram-support-bot.sqlite ".backup backup-$(date +%F).sqlite"',
    cloudflareD1: 'wrangler d1 export telegram_support_bot --remote --output backup.sql',
    restoreAdvice: '恢复前先停止服务或确认没有写入；恢复文件不要提交到 Git。',
  };
}

export async function applyBasicInstallPreset(env: Env): Promise<void> {
  await runSetupWizard(env, 'basic');
}

export async function getSystemStatus(env: Env, origin?: string) {
  const aiModels = await listAiModels(env.DB).catch(() => []);
  const defaultModel = await getDefaultAiModel(env.DB).catch(() => null);
  const publicUrl = env.PUBLIC_URL || await getSetting(env.DB, 'public_url') || origin || '';
  const webhookLastSetAt = await getSetting(env.DB, 'webhook_last_set_at');
  const webhookLastUrl = await getSetting(env.DB, 'webhook_last_url');
  const telegramLoginReady = Boolean(env.BOT_TOKEN && env.OWNER_IDS?.trim() && env.KV);
  return {
    runtime: origin?.includes('localhost') || origin?.includes('127.0.0.1') ? 'server/local' : 'web',
    checks: [
      check('Bot Token', Boolean(env.BOT_TOKEN), env.BOT_TOKEN ? '已绑定 Bot Token' : '未绑定 Bot Token，机器人无法工作', 'error'),
      check('Owner 登录', telegramLoginReady, telegramLoginReady ? `Telegram 验证码登录已启用：${maskOwners(env.OWNER_IDS)}` : '未配置 Bot Token / Owner ID / KV，无法 Telegram 验证码登录', 'error'),
      check('访问地址', Boolean(publicUrl), publicUrl ? publicUrl : '未配置 PUBLIC_URL', 'warn'),
      check('HTTPS / Webhook', Boolean(webhookLastSetAt || publicUrl.startsWith('https://')), webhookLastSetAt ? `最近设置：${webhookLastSetAt} · ${webhookLastUrl ?? ''}` : publicUrl.startsWith('https://') ? '域名已是 HTTPS，可在“域名 HTTPS”页设置 webhook' : 'Telegram webhook 必须使用 HTTPS', 'warn'),
      check('后台 Forum 群', Boolean(env.SUPPORT_CHAT_ID), env.SUPPORT_CHAT_ID ? `已配置：${env.SUPPORT_CHAT_ID}` : '未配置。把 bot 拉进开启 Topics 的后台群，在群里发 /setup 获取群 ID，再填入 support_chat_id。', 'warn'),
      check('Webhook Secret', Boolean(env.WEBHOOK_SECRET), env.WEBHOOK_SECRET ? '已配置，不显示明文' : '未配置，建议重新初始化或补充配置', 'error'),
      check('加密密钥', Boolean(env.ENCRYPTION_SECRET), env.ENCRYPTION_SECRET ? '已配置，可安全保存 Provider API Key' : '未配置，不能保存 Provider API Key', 'warn'),
      check('数据库', Boolean(env.DB), env.DB ? 'SQLite/D1 可用' : '数据库未绑定', 'error'),
      check('AI 模型', Boolean(defaultModel || env.AI_API_KEY), defaultModel ? `默认模型：${defaultModel.id}` : env.AI_API_KEY ? '已配置 AI_API_KEY' : '未配置 AI Provider/模型；可在设置页添加', 'warn'),
      check('知识库', env.KB_ENABLED === 'true', env.KB_ENABLED === 'true' ? '知识库已开启，请避免导入敏感原始聊天记录' : '知识库关闭，AI 不读取知识库', 'ok'),
    ],
    nextSteps: [
      env.SUPPORT_CHAT_ID ? '' : '配置后台 Forum 群：群内 /setup 获取 support_chat_id',
      webhookLastSetAt ? '' : '在“域名 HTTPS”页点击重新设置 Telegram Webhook',
      defaultModel || env.AI_API_KEY ? '' : '按需添加 AI Provider 和默认模型',
      '初始化欢迎语、快捷回复和关键词回复',
    ].filter(Boolean),
    counts: { aiModels: aiModels.length },
  };
}

function check(key: string, ok: boolean, message: string, missingLevel: CheckLevel): { key: string; ok: boolean; level: CheckLevel; message: string } {
  return { key, ok, level: ok ? 'ok' : missingLevel, message };
}

function maskOwners(value?: string): string {
  const ids = (value ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return ids.map((id) => id.length > 4 ? `${id.slice(0, 2)}****${id.slice(-2)}` : '****').join(', ');
}
