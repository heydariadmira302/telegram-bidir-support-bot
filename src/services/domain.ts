import { getSetting, setSetting } from '../db';
import { setMyCommands, setWebhook } from '../telegram';
import { webhookPathForBot } from '../tenant';
import type { Env } from '../types';

export interface DomainPanelData {
  domain: string;
  publicUrl: string;
  detectedOrigin: string;
  webhookUrl: string;
  httpsEnabled: boolean;
  cloudflareMode: boolean;
  readyForWebhook: boolean;
  caddyfile: string;
  nginxConfig: string;
  checks: Array<{ key: string; level: 'ok' | 'warn' | 'error'; message: string }>;
}

export async function getDomainPanel(env: Env, origin: string): Promise<DomainPanelData> {
  const publicUrl = (await getSetting(env.DB, 'public_url')) || env.PUBLIC_URL || origin;
  const domain = stripProtocol(publicUrl);
  const httpsEnabled = publicUrl.startsWith('https://');
  const cloudflareMode = isLikelyCloudflareDomain(domain);
  const webhookUrl = `${publicUrl.replace(/\/$/, '')}/telegram/webhook`;
  return {
    domain,
    publicUrl,
    detectedOrigin: origin,
    webhookUrl,
    httpsEnabled,
    cloudflareMode,
    readyForWebhook: httpsEnabled,
    caddyfile: renderCaddyfile(domain),
    nginxConfig: renderNginxConfig(domain),
    checks: buildChecks(publicUrl, origin, cloudflareMode),
  };
}

export async function saveDomainConfig(env: Env, input: { domain?: string; publicUrl?: string }): Promise<void> {
  const publicUrl = normalizePublicUrl(input.publicUrl || input.domain || '');
  await setSetting(env.DB, 'public_url', publicUrl);
}

export async function setupTelegramWebhook(env: Env): Promise<string> {
  const publicUrl = (await getSetting(env.DB, 'public_url')) || env.PUBLIC_URL || '';
  if (!publicUrl.startsWith('https://')) throw new Error('Telegram webhook 必须使用 HTTPS，请先配置 https:// 域名');
  if (!env.BOT_TOKEN) throw new Error('BOT_TOKEN 未配置');
  if (!env.WEBHOOK_SECRET) throw new Error('WEBHOOK_SECRET 未配置');
  const webhookUrl = webhookPathForBot(publicUrl, env.BOT_ID || 'default');
  await setWebhook(env, webhookUrl, env.WEBHOOK_SECRET);
  await setMyCommands(env);
  await setSetting(env.DB, 'webhook_last_set_at', new Date().toISOString(), env);
  await setSetting(env.DB, 'webhook_last_url', webhookUrl, env);
  return webhookUrl;
}

export function normalizePublicUrl(value: string): string {
  value = value.trim();
  if (!value) throw new Error('域名不能为空');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  if (!url.hostname.includes('.')) throw new Error('请填写完整域名，例如 support.example.com');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('只支持 http 或 https');
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function stripProtocol(publicUrl: string): string {
  try {
    return new URL(publicUrl).host;
  } catch {
    return publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
}

function buildChecks(publicUrl: string, origin: string, cloudflareMode: boolean): DomainPanelData['checks'] {
  const checks: DomainPanelData['checks'] = [];
  checks.push({ key: 'PUBLIC_URL', level: publicUrl.startsWith('https://') ? 'ok' : 'warn', message: publicUrl.startsWith('https://') ? '已使用 HTTPS，可用于 Telegram webhook' : '当前是 HTTP，Telegram webhook 不能使用 HTTP' });
  checks.push({ key: '当前访问地址', level: sameHost(publicUrl, origin) ? 'ok' : 'warn', message: sameHost(publicUrl, origin) ? '当前访问地址与 PUBLIC_URL 匹配' : `当前访问地址为 ${origin}，与 PUBLIC_URL 不一致时请确认反代/DNS 是否生效` });
  checks.push({ key: 'Cloudflare', level: cloudflareMode ? 'ok' : 'warn', message: cloudflareMode ? '适合使用 Cloudflare HTTPS + Nginx 反代' : '如果未使用 Cloudflare，可考虑 Caddy 自动证书' });
  checks.push({ key: 'Webhook 地址', level: publicUrl.startsWith('https://') ? 'ok' : 'error', message: `${publicUrl.replace(/\/$/, '')}/telegram/webhook` });
  return checks;
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

function isLikelyCloudflareDomain(domain: string): boolean {
  return Boolean(domain) && !domain.includes(':');
}

function renderCaddyfile(domain: string): string {
  return `${domain} {\n  reverse_proxy 127.0.0.1:3000\n}`;
}

function renderNginxConfig(domain: string): string {
  return `server {\n    listen 80;\n    server_name ${domain};\n\n    location / {\n        proxy_pass http://127.0.0.1:3000;\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}`;
}
