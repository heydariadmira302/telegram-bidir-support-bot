import { addAdmin } from './db';
import { isMissingSettingsTableError, normalizeInstallConfig, saveInstallConfig, validateInstallConfig, withRuntimeConfig } from './config';
import { bootstrapFreshDatabase } from './migrations';
import { htmlPage } from './admin-render';
import { setWebhook } from './telegram';
import type { Env } from './types';

export function installPage(request: Request, error = '', values: Record<string, string> = {}): Response {
  const detectedPublicUrl = detectPublicUrl(request);
  const v = (key: string, fallback = '') => esc(values[key] ?? fallback);
  return htmlPage(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>初始化 Telegram 客服 Bot</title><style>${css()}</style></head><body><main class="install"><h1>初始化 Telegram 客服 Bot</h1><p class="muted">首次安装只需要在这里填一次。保存成功后初始化页面会关闭，后续从后台设置里管理。</p>${error ? `<p class="danger-text">${esc(error)}</p>` : ''}
<form method="POST" action="/install" class="stack">
  <section class="panel"><h2>1. Bot 信息</h2>
    <label>BOT_TOKEN<input type="password" name="bot_token" value="${v('bot_token')}" placeholder="从 @BotFather 获取，例如 123456:ABC..." required /></label>
    <label>Owner Telegram 数字 ID<input name="owner_ids" value="${v('owner_ids')}" placeholder="123456789，多个用英文逗号" required /></label>
    <p class="muted">BOT_TOKEN 从 Telegram 私聊 <b>@BotFather</b> 获取。Owner 数字 ID 用于接收后台登录验证码；不是 username。不会填的话可以先私聊 <b>@userinfobot</b> 查看你的 ID。</p>
  </section>
  <section class="panel"><h2>2. 访问地址与安全密钥</h2>
    <label>公网访问地址 PUBLIC_URL<input name="public_url" value="${v('public_url', detectedPublicUrl)}" placeholder="http://服务器IP:3000 或 https://域名" required /></label>
    <p class="muted">已自动按当前访问地址预填。临时测试可用 IP + 端口；正式使用建议后台里再绑定域名和 HTTPS。</p>
    <label>Webhook Secret <button class="mini" type="button" data-generate="webhook_secret" data-length="40">一键生成</button><input type="password" name="webhook_secret" value="${v('webhook_secret', randomToken(40))}" required /></label>
    <label>加密密钥 ENCRYPTION_SECRET <button class="mini" type="button" data-generate="encryption_secret" data-length="48">一键生成</button><input type="password" name="encryption_secret" value="${v('encryption_secret', randomToken(48))}" required /></label>
    <input type="hidden" name="support_chat_id" value="" />
    <input type="hidden" name="admin_password" value="" />
    <input type="hidden" name="kb_enabled" value="false" />
    <input type="hidden" name="ai_auto_reply" value="false" />
  </section>
  <button>保存并完成初始化</button>
</form><p class="muted">后台 Forum 群、AI Provider / 模型 / 知识库不在初始化页配置，初始化完成后去后台“设置/系统”里管理。</p></main></body></html>`);
}

export async function handleInstallRequest(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return installPage(request, 'D1 数据库没有绑定。请在 Cloudflare Pages/Workers 里添加 D1 绑定，变量名必须是 DB。');
  if (!env.KV) return installPage(request, 'KV 命名空间没有绑定。请在 Cloudflare Pages/Workers 里添加 KV 绑定，变量名必须是 KV。后台 Telegram 验证码和登录限流依赖 KV。');
  try {
    await bootstrapFreshDatabase(env);
  } catch (err) {
    return installPage(request, installErrorMessage(err));
  }
  if (request.method === 'GET') return installPage(request);
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let config: Record<string, string> = {};
  try {
    const form = await request.formData();
    config = Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
    config = normalizeInstallConfig(config);
    const error = validateInstallConfig(config);
    if (error) return installPage(request, error, config);

    await saveInstallConfig(env, config);
    for (const ownerId of config.owner_ids.split(',').map((x) => x.trim()).filter(Boolean)) {
      await addAdmin(env.DB, ownerId, 'owner', 'owner');
    }

    const runtimeEnv = await withRuntimeConfig(env);
    const webhookUrl = `${config.public_url.replace(/\/$/, '')}/telegram/webhook`;
    let notice = '初始化完成';
    if (webhookUrl.startsWith('https://')) {
      const webhookResult = await trySetInstallWebhook(runtimeEnv, webhookUrl);
      if (webhookResult) notice = `初始化完成，但 webhook 设置失败：${webhookResult}。请修正后在后台重新设置 webhook。`;
      else notice = '初始化完成，webhook 已设置';
    } else {
      notice = '初始化完成；当前是 HTTP 访问，已跳过 webhook。绑定 HTTPS 后再设置 webhook。';
    }
    return new Response(null, { status: 303, headers: [['location', '/admin?notice=' + encodeURIComponent(notice)], ['cache-control', 'no-store']] });
  } catch (err) {
    console.error('install failed', err);
    if (isMissingSettingsTableError(err)) {
      return installPage(request, 'D1 数据库缺少 settings 表，且自动建表没有完成。请确认绑定的是一个空 D1 数据库，变量名为 DB，然后重新打开 /install。', config);
    }
    return installPage(request, installErrorMessage(err), config);
  }
}

async function trySetInstallWebhook(env: Env, webhookUrl: string): Promise<string | null> {
  try {
    await setWebhook(env, webhookUrl, env.WEBHOOK_SECRET);
    return null;
  } catch (err) {
    console.error('install webhook failed', err);
    return installErrorMessage(err);
  }
}

function installErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err || '未知错误');
}

function randomToken(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}

function detectPublicUrl(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '') || 'http';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
  return `${proto}://${host}`.replace(/\/$/, '');
}

function esc(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function css(): string {
  return `:root{color-scheme:light dark;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7fb;color:#111827}body{margin:0}main{max-width:880px;margin:0 auto;padding:28px}.panel{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 8px 30px #0001}.muted{color:#6b7280}.danger-text{color:#b91c1c}.hint{background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:12px}.stack{display:flex;flex-direction:column;gap:10px}label{display:flex;flex-direction:column;gap:6px;font-weight:600}input,textarea{padding:10px;border:1px solid #d1d5db;border-radius:10px;font:inherit}textarea{min-height:96px}button{border:0;background:#2563eb;color:white;border-radius:10px;padding:12px 16px;cursor:pointer;font-size:16px}.mini{align-self:flex-start;padding:6px 10px;font-size:12px;background:#e5e7eb;color:#111827}@media(prefers-color-scheme:dark){:root{background:#0b1020;color:#e5e7eb}.panel{background:#111827}.hint{background:#0b1020;border-color:#374151}input,textarea{background:#0b1020;color:#e5e7eb;border-color:#374151}.mini{background:#1f2937;color:#e5e7eb}}`;
}
