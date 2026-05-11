import { getDomainPanel } from './services/domain';
import { csrfInput } from './admin-auth';
import { esc, layout } from './admin-render';
import type { Env } from './types';

export async function renderDomainPage(env: Env, request: Request, canWrite = true): Promise<string> {
  const data = await getDomainPanel(env, new URL(request.url).origin);
  return layout(`
    <nav class="tabs">${tab('users', '用户', 'domain')}${tab('pending', '待处理', 'domain')}${tab('replies', '话术', 'domain')}${tab('broadcasts', '广播', 'domain')}${tab('settings', '设置', 'domain')}${tab('system', '系统', 'domain')}${tab('domain', '域名 HTTPS', 'domain')}</nav>
    <section class="cards">
      <div class="card"><b>${esc(data.domain || '-')}</b><span>当前域名</span></div>
      <div class="card ${data.httpsEnabled ? '' : 'warn'}"><b>${data.httpsEnabled ? 'HTTPS' : 'HTTP'}</b><span>外部访问</span></div>
      <div class="card ${data.cloudflareMode ? '' : 'warn'}"><b>${data.cloudflareMode ? 'Cloudflare' : '直连'}</b><span>推荐接入方式</span></div>
      <div class="card ${data.readyForWebhook ? '' : 'warn'}"><b>${data.readyForWebhook ? '可设置' : '待处理'}</b><span>Webhook</span></div>
    </section>

    <section class="panel"><h2>访问地址</h2><p class="muted">这里决定后台生成 webhook 时使用哪个公网地址。Cloudflare 代理已开启时，推荐填写 <code>https://你的域名</code>。</p>
      <form method="POST" action="/admin" class="stack" data-api="/admin/api/install/domain">${csrfInput()}<input name="domain" value="${esc(data.publicUrl)}" placeholder="https://support.example.com" /><button ${canWrite ? '' : 'disabled'}>保存访问地址</button></form>
    </section>

    <section class="panel"><h2>部署状态</h2>${data.checks.map((x) => `<div class="row"><b>${esc(x.key)}</b><span class="badge ${x.level === 'error' ? 'danger' : x.level === 'warn' ? 'warn' : ''}">${esc(x.level.toUpperCase())}</span><span>${esc(x.message)}</span></div>`).join('')}</section>

    <section class="two">
      <div class="panel"><h2>Cloudflare 代理模式（推荐）</h2><ol><li>Cloudflare DNS：<code>${esc(data.domain || 'support.example.com')}</code> 开启小黄云。</li><li>源站指向本服务器 IP。</li><li>SSL/TLS 模式可先用 Flexible；更严格可后续切 Full。</li><li>服务器 Nginx 将 80 端口反代到 <code>127.0.0.1:3000</code>。</li></ol><p class="muted">这种模式不需要后台申请源站证书，Cloudflare 会给访客提供 HTTPS。</p></div>
      <div class="panel"><h2>直连 Caddy 模式</h2><p class="muted">只有当 DNS 直接指向服务器、不开 Cloudflare 代理时，才建议用 Caddy 自动申请证书。</p><details><summary>查看 Caddy 配置</summary><pre>${esc(data.caddyfile)}</pre></details></div>
    </section>

    <section class="panel"><h2>一键配置 Caddy + 自动证书</h2><p class="danger-text">高级操作：仅适合直连模式。Cloudflare 小黄云已开启时通常不需要点这个。</p><form method="POST" action="/admin" class="stack" data-confirm="确认要写入 Caddy 配置并 reload 服务？Cloudflare 代理模式通常不需要。">${csrfInput()}<input type="hidden" name="action" value="caddy_apply" /><input name="public_url" value="${esc(data.publicUrl)}" placeholder="https://support.example.com" /><input name="confirm_value" placeholder="输入 APPLY_CADDY 确认" /><button class="danger" ${canWrite ? '' : 'disabled'}>一键配置 Caddy + 自动证书</button></form></section>

    <section class="panel"><h2>Telegram Webhook</h2><p class="muted">Telegram webhook 必须使用 HTTPS。后台会自动读取 WEBHOOK_SECRET，不会在页面显示明文。</p><pre>${esc(data.webhookUrl)}</pre><form method="POST" action="/admin" class="inline" data-api="/admin/api/install/webhook" data-confirm="确认重新设置 Telegram webhook？">${csrfInput()}<button ${canWrite && data.readyForWebhook ? '' : 'disabled'}>重新设置 Telegram Webhook</button></form>${data.readyForWebhook ? '' : '<p class="danger-text">当前不是 HTTPS，不能设置 Telegram webhook。</p>'}</section>
  `);
}

function tab(id: string, name: string, page: string): string {
  return `<a class="${page === id ? 'active' : ''}" href="/admin?page=${id}">${name}</a>`;
}
