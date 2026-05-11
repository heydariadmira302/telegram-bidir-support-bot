import {
  getAdminsPanel,
  getAiConfigPanel,
  getAuditPanel,
  getBotPanel,
  getBroadcastDetail,
  getBroadcastPanel,
  getDashboard,
  getBackupInstructions,
  getKnowledgePanel,
  getSettingsPanel,
  getSystemStatus,
  getUserDetail,
  getWorkspaceApiPanel,
  type UserAction,
} from './service';
import { clearCsrfCookie, clearLoginChallengeCookie, clearSessionCookie, createLoginChallenge, createLoginChallengeCookie, createSessionCookie, csrfInput, clearLoginFailures, getLoginChallengeId, isAuthed, isLoginLimited, isTelegramLoginEnabled, getTelegramLoginStatus, loginClientId, newCsrfCookie, recordLoginFailure, redirectWithSession, shouldUseSecureCookies, verifyLoginChallenge } from './admin-auth';
import { canAccessAudit, canManageAdmins, canManageAiProviders, getAdminSession, parseOwnerIds } from './admin-permissions';
import { esc, htmlPage, layout, loginCodePage, loginPage, noStoreJson, withFlash } from './admin-render';
import { renderDomainPage } from './admin-domain';
import { handleApiRequest } from './admin-api';
import { handlePost } from './admin-post';
import { resolveAdminTenant } from './admin-tenant';
import { listBots } from './db';
import { sendMessage } from './telegram';
import { botWebhookUrl } from './services/bots';
import type { AdminSession, AiModelRow, AiProviderRow, BotRow, Env, KeywordReplyRow, QuickReplyRow, UserRow, WorkspaceAdminRow, WorkspaceRow } from './types';

export async function handleAdminRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  const telegramLoginStatus = getTelegramLoginStatus(env);
  const telegramLogin = telegramLoginStatus.enabled;
  const secureCookies = shouldUseSecureCookies(request);

  if (!telegramLogin && !env.ADMIN_PASSWORD) return new Response(`Admin disabled: ${telegramLoginStatus.reason}`, { status: 404 });

  if (url.pathname === '/admin/logout') {
    return new Response(null, { status: 303, headers: [['location', '/admin/login?notice=' + encodeURIComponent('已退出登录')], ['set-cookie', clearSessionCookie(secureCookies)], ['set-cookie', clearCsrfCookie(secureCookies)], ['set-cookie', clearLoginChallengeCookie(secureCookies)], ['cache-control', 'no-store']] });
  }

  if (request.method === 'POST' && url.pathname === '/admin/login') {
    const clientId = loginClientId(request);
    if (await isLoginLimited(env, clientId)) return loginPage(url.pathname, true, '尝试次数太多，请稍后再试。', 429, telegramLogin, telegramLoginStatus.reason);
    const form = await request.formData();
    const password = String(form.get('password') ?? '');
    if (!telegramLogin && password !== env.ADMIN_PASSWORD) {
      await recordLoginFailure(env, clientId);
      return loginPage(url.pathname, true, '密码错误', 401, telegramLogin, telegramLoginStatus.reason);
    }
    if (telegramLogin) {
      const adminId = [...parseOwnerIds(env.OWNER_IDS)][0];
      if (!adminId) return loginPage(url.pathname, true, 'OWNER_IDS 未配置，无法发送 Telegram 验证码', 500, telegramLogin, telegramLoginStatus.reason);
      try {
        const challenge = await createLoginChallenge(env, adminId, clientId);
        await sendMessage(env, adminId, `后台登录验证码：<code>${challenge.code}</code>\n5 分钟内有效。如果不是你本人操作，请忽略。`);
        return new Response(null, { status: 303, headers: [['location', '/admin/verify'], ['set-cookie', createLoginChallengeCookie(challenge.challengeId, secureCookies)], ['cache-control', 'no-store']] });
      } catch (err) {
        console.error('telegram login code failed', err);
        return loginPage(url.pathname, true, `Telegram 验证码发送失败：${loginSendErrorMessage(err)}`, 500, telegramLogin, telegramLoginStatus.reason);
      }
    }
    await clearLoginFailures(env, clientId);
    return redirectWithSession('/admin', await createSessionCookie(env, 'web-admin', secureCookies), newCsrfCookie(secureCookies));
  }

  if (url.pathname === '/admin/verify') {
    const clientId = loginClientId(request);
    const challengeId = getLoginChallengeId(request);
    if (!challengeId) return loginPage('/admin/login', true, '验证码已过期，请重新登录。', 401, telegramLogin, telegramLoginStatus.reason);
    if (request.method === 'GET') return loginCodePage('/admin/verify', false, '', 200);
    if (request.method === 'POST') {
      const form = await request.formData();
      const actor = await verifyLoginChallenge(env, challengeId, String(form.get('code') ?? ''), clientId);
      if (!actor) {
        await recordLoginFailure(env, clientId);
        return loginCodePage('/admin/verify', true);
      }
      await clearLoginFailures(env, clientId);
      return new Response(null, { status: 303, headers: [['location', '/admin'], ['set-cookie', await createSessionCookie(env, actor, secureCookies)], ['set-cookie', newCsrfCookie(secureCookies)], ['set-cookie', clearLoginChallengeCookie(secureCookies)], ['cache-control', 'no-store']] });
    }
  }

  const key = url.searchParams.get('key');
  if (env.ADMIN_PASSWORD && key && key === env.ADMIN_PASSWORD) {
    return loginPage('/admin/login', true, '安全起见，后台已关闭 URL key 直登，请使用 Telegram 验证码或密码登录。', 401, telegramLogin, telegramLoginStatus.reason);
  }

  const authed = await isAuthed(request, env);
  if (!authed) return loginPage('/admin/login', false, '密码错误', 401, telegramLogin, telegramLoginStatus.reason);

  const session = await getAdminSession(request, env);

  const page = url.searchParams.get('page') ?? 'dashboard';
  const wantsApi = url.pathname.startsWith('/admin/api/');
  let postForm: FormData | null = null;
  if (request.method === 'POST' && !wantsApi) postForm = await request.clone().formData();
  const tenantPages = new Set(['api', 'dashboard', 'users', 'pending', 'replies', 'settings', 'broadcasts', 'broadcast', 'user', 'ai', 'admins', 'bots']);
  let viewEnv = env;
  let currentBot: BotRow | null = null;
  if (tenantPages.has(page) || url.pathname.startsWith('/admin/api/') || request.method === 'POST') {
    try {
      const formBot = postForm ? String(postForm.get('bot') ?? '') : '';
      const formWorkspace = postForm ? String(postForm.get('workspace') ?? '') : '';
      const referer = (() => { try { const ref = request.headers.get('referer'); return ref ? new URL(ref) : null; } catch { return null; } })();
      const resolved = await resolveAdminTenant(env, {
        workspaceId: formWorkspace || url.searchParams.get('workspace') || referer?.searchParams.get('workspace'),
        botId: formBot || url.searchParams.get('bot') || referer?.searchParams.get('bot'),
        session,
      });
      viewEnv = resolved.env;
      currentBot = resolved.bot;
    } catch (err) {
      return htmlPage(layout(`<section class="panel"><h2>Bot 选择错误</h2><p class="danger-text">${esc(err instanceof Error ? err.message : String(err))}</p><p><a href="/admin?page=bots">去 Bot 管理</a> · <a href="/admin?page=${encodeURIComponent(page)}&bot=default">切回 default</a></p></section>`), 400);
    }
  }

  if (url.pathname.startsWith('/admin/api/')) return handleApiRequest(request, viewEnv);
  if (request.method === 'POST') return handlePost(request, viewEnv, renderUserDetail);

  const q = url.searchParams.get('q') ?? undefined;
  const userId = url.searchParams.get('id') ?? undefined;
  const broadcastId = url.searchParams.get('broadcast_id') ?? undefined;

  const chrome = await adminChrome(env, viewEnv, currentBot, page);
  if (page === 'api') return noStoreJson(await getDashboard(viewEnv, q));
  if (page === 'user' && userId) return htmlPage(withFlash(request, await renderUserDetail(viewEnv, userId, undefined, session.canWrite, chrome)));
  if (page === 'settings') return htmlPage(withFlash(request, await renderSettings(viewEnv, session, chrome, request)));
  if (page === 'bots') return htmlPage(withFlash(request, await renderBots(viewEnv, session, chrome)));
  if (page === 'ai') return htmlPage(withFlash(request, await renderAi(viewEnv, session, chrome)));
  if (page === 'admins') return htmlPage(withFlash(request, await renderAdmins(viewEnv, session, chrome)));
  if (page === 'knowledge' && env.KB_ENABLED === 'true') return htmlPage(withFlash(request, await renderKnowledge(env, q, session.canWrite)));
  if (page === 'system') return htmlPage(withFlash(request, await renderSystem(env, request, session.canWrite)));
  if (page === 'domain') return htmlPage(withFlash(request, await renderDomainPage(env, request, session.canWrite)));
  if (page === 'backup') return htmlPage(withFlash(request, renderBackup()));
  if (page === 'audit') return canAccessAudit(session) ? htmlPage(withFlash(request, await renderAudit(env))) : new Response('Owner permission required', { status: 403 });
  if (page === 'broadcasts') return htmlPage(withFlash(request, await renderBroadcasts(viewEnv, session.canWrite, chrome)));
  if (page === 'broadcast' && broadcastId) return htmlPage(withFlash(request, await renderBroadcastDetail(viewEnv, broadcastId, chrome)));

  return htmlPage(withFlash(request, await renderDashboard(viewEnv, page, q, session, chrome)));
}

async function renderDashboard(env: Env, page: string, q: string | undefined, session: AdminSession, chrome = ''): Promise<string> {
  const data = await getDashboard(env, q);
  const activeUsers = page === 'pending' ? data.pending : data.users;
  const nav = renderMainTabs(page, env, session);
  if (page === 'dashboard') return layout(`${chrome}${nav}${await renderHomeDashboard(env, session)}`);
  return layout(`
    ${chrome}
    ${nav}
    ${page === 'replies' ? renderReplies(data.quick, data.keywords, env, session.canWrite) : renderUsers(activeUsers, q, env)}
  `);
}

async function renderHomeDashboard(env: Env, session: AdminSession): Promise<string> {
  const data = await getDashboard(env);
  const importantUsers = data.users.filter((u) => Boolean(u.important) && !u.is_blocked).length;
  const blockedUsers = data.users.filter((u) => Boolean(u.is_blocked)).length;
  return `
    <section class="cards">
      <div class="card"><b>${data.users.length}</b><span>最近客户</span></div>
      <div class="card warn"><b>${data.pending.length}</b><span>待处理</span></div>
      <div class="card"><b>${importantUsers}</b><span>重要客户</span></div>
      <div class="card"><b>${blockedUsers}</b><span>已拉黑</span></div>
    </section>
    <section class="panel">
      <div class="section-title"><div><h2>后台导航</h2><p class="muted">首页只做轻量概览，具体业务到对应模块处理，避免把所有功能堆在默认页面。</p></div><span class="badge">API-first</span></div>
      <div class="quick-grid">
        <a class="quick-card" href="/admin?page=users${tenantParam(env, '&')}"><b>客户</b><p class="muted">搜索客户、备注、标签、进入工单。</p></a>
        <a class="quick-card" href="/admin?page=pending${tenantParam(env, '&')}"><b>待处理</b><p class="muted">只看需要客服回复的用户。</p></a>
        <a class="quick-card" href="/admin?page=replies${tenantParam(env, '&')}"><b>话术</b><p class="muted">快捷回复、关键词自动回复。</p></a>
        <a class="quick-card" href="/admin?page=broadcasts${tenantParam(env, '&')}"><b>广播</b><p class="muted">创建草稿、筛选目标、二次确认发送。</p></a>
        <a class="quick-card" href="/admin?page=bots${tenantParam(env, '&')}"><b>Workspace / Bot</b><p class="muted">多 Bot、Webhook、Token hint。</p></a>
        <a class="quick-card" href="/admin?page=settings${tenantParam(env, '&')}"><b>设置</b><p class="muted">后台群、敏感词、初始化向导。</p></a>
        ${session.role === 'owner' ? `<a class="quick-card" href="/admin?page=ai${tenantParam(env, '&')}"><b>AI</b><p class="muted">Provider、模型、默认模型。</p></a><a class="quick-card" href="/admin?page=admins${tenantParam(env, '&')}"><b>管理员</b><p class="muted">全局和 Workspace 权限。</p></a>` : ''}
      </div>
    </section>
    <section class="panel">
      <div class="section-title"><h2>最近客户</h2><a href="/admin?page=users${tenantParam(env, '&')}">查看全部 →</a></div>
      ${data.users.slice(0, 5).map((u) => `<article class="broadcast"><div class="section-title"><div><b>${esc([u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || u.user_chat_id)}</b><p class="muted">${esc(u.last_message_at || u.updated_at || '-')}</p></div><div class="badges">${statusBadges(u)}</div></div><p><a href="/admin?page=user&id=${encodeURIComponent(u.user_chat_id)}${tenantParam(env, '&')}">进入工单 →</a></p></article>`).join('') || '<div class="empty">暂无客户</div>'}
    </section>
  `;
}

function queueMiniList(users: UserRow[], env?: Env): string {
  return users.map((u) => `<article class="quick-card"><b>${esc([u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || u.user_chat_id)}</b><p class="muted">${esc(u.last_message_at || u.updated_at || '-')}</p><div class="badges">${statusBadges(u)}</div><p><a href="/admin?page=user&id=${encodeURIComponent(u.user_chat_id)}${tenantParam(env, '&')}">进入工单 →</a></p></article>`).join('') || '<div class="empty">暂无数据</div>';
}

async function renderUserDetail(env: Env, userId: string, aiDraft?: string, canWrite = true, chrome = ''): Promise<string> {
  const { user, logs } = await getUserDetail(env, userId);
  if (!user) return layout(`${chrome}<p class="muted">找不到用户 <code>${esc(userId)}</code></p><p><a href="/admin${tenantQuery(env)}">返回</a></p>`);
  const quick = (await getDashboard(env)).quick;
  return layout(`
    ${chrome}
    <p><a href="/admin${tenantQuery(env)}">← 返回客户列表</a></p>
    <section class="workbench">
      <div class="panel">
        <div class="section-title"><div><h2>消息记录</h2><p class="muted">客服工单视图：左侧看上下文，右侧处理客户资料和快捷操作。<span id="timeline-status">自动刷新中</span></p></div><span class="badge" id="timeline-count">${logs.length} 条</span></div>
        <div class="timeline" id="message-timeline" data-user-id="${esc(user.user_chat_id)}">
          ${renderTimelineMessages(logs)}
        </div>
        <hr style="border:0;border-top:1px solid #edf1f6;margin:18px 0" />
        <h2>回复客户</h2>
        <form method="POST" action="/admin" class="stack" data-api="/admin/api/direct-reply">${csrfInput()}<input type="hidden" name="user_id" value="${esc(user.user_chat_id)}" /><textarea name="text" placeholder="输入后直接发送给客户"></textarea><button ${canWrite ? '' : 'disabled'}>发送人工回复</button></form>
        ${quick.length ? `<form method="POST" action="/admin" class="inline" data-api="/admin/api/direct-reply">${csrfInput()}<input type="hidden" name="user_id" value="${esc(user.user_chat_id)}" /><select name="quick_key">${quick.map((x) => `<option value="${esc(x.key)}">${esc(x.key)} - ${esc(x.text).slice(0, 80)}</option>`).join('')}</select><button ${canWrite ? '' : 'disabled'}>发送快捷回复</button></form>` : '<p class="muted">暂无快捷回复，可先在“话术”里添加。</p>'}
        <form method="POST" action="/admin" class="stack" data-api="/admin/api/ai-draft">${csrfInput()}<input type="hidden" name="user_id" value="${esc(user.user_chat_id)}" /><textarea name="prompt" placeholder="可选：给 AI 的补充要求；只生成草稿，不会自动发送"></textarea><button class="secondary">生成 AI 草稿</button></form>
        ${aiDraft ? `<div class="msg out"><b>AI 草稿</b><p>${esc(aiDraft)}</p><p class="muted">请人工确认后再复制发送。</p></div>` : ''}
      </div>
      <aside>
        ${userCard(user, true, env)}
        <section class="panel"><h2>危险操作</h2><p class="muted">删除会清理系统里的客户、消息记录和映射关系，不会删除 Telegram 里的用户或群历史消息。</p><form method="POST" action="/admin" data-api="/admin/api/user" data-confirm="确定删除这个会话？系统内客户资料和消息记录会被清理，无法从后台恢复。">${csrfInput()}<input type="hidden" name="action" value="delete" /><input type="hidden" name="delete" value="true" /><input type="hidden" name="user_id" value="${esc(user.user_chat_id)}" /><button class="secondary danger" ${canWrite ? '' : 'disabled'}>删除会话</button></form></section>
        <section class="panel"><h2>快捷回复</h2>${quick.length ? `<div class="quick-grid">${quick.slice(0, 8).map((x) => `<div class="quick-card"><b>${esc(x.key)}</b><p class="muted">${esc(x.text).slice(0, 120)}</p></div>`).join('')}</div>` : '<p class="muted">暂无快捷回复</p>'}<p><a href="/admin?page=replies${tenantParam(env, '&')}">管理话术 →</a></p></section>
      </aside>
    </section>
  `);
}





function renderTimelineMessages(logs: Array<{ id?: number | null; direction: string; created_at: string; text?: string | null; media_type?: string | null; file_id?: string | null; file_name?: string | null; duration?: number | null }>): string {
  return logs.map((x) => `<div class="msg ${x.direction === 'in' ? 'in' : 'out'}" data-log-id="${esc(x.id ?? '')}"><b>${x.direction === 'in' ? '用户' : '客服'}</b><span>${esc(x.created_at)}</span>${renderMessageLogContent(x)}</div>`).join('') || '<div class="empty">暂无消息记录</div>';
}

function renderMessageLogContent(log: { id?: number | null; text?: string | null; media_type?: string | null; file_id?: string | null; file_name?: string | null; duration?: number | null }): string {
  const parts: string[] = [];
  if (log.media_type === 'voice' && log.file_id) {
    const src = `/admin/file/${encodeURIComponent(String(log.id ?? log.file_id))}`;
    parts.push(`<p><b>语音消息</b>${log.duration ? ` · ${esc(log.duration)} 秒` : ''}</p><audio controls preload="metadata" src="${src}"></audio><p class="muted"><a href="${src}" target="_blank" rel="noopener noreferrer">打不开就点这里播放/下载</a></p>`);
  } else if (log.media_type === 'audio' && log.file_id) {
    const src = `/admin/file/${encodeURIComponent(String(log.id ?? log.file_id))}`;
    parts.push(`<p><b>音频消息</b>${log.file_name ? ` · ${esc(log.file_name)}` : ''}${log.duration ? ` · ${esc(log.duration)} 秒` : ''}</p><audio controls preload="metadata" src="${src}"></audio><p class="muted"><a href="${src}" target="_blank" rel="noopener noreferrer">打不开就点这里播放/下载</a></p>`);
  }
  if (log.text) parts.push(`<p>${esc(log.text)}</p>`);
  if (!parts.length) parts.push('<p class="muted">暂不支持预览的消息类型</p>');
  return parts.join('');
}

function loginSendErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('KV is required')) return 'KV 没有绑定，变量名必须是 KV。';
  if (message.includes('network failed') || message.includes('fetch failed') || message.includes('ETIMEDOUT') || message.includes('ENETUNREACH')) return '服务器连接 Telegram API 失败，已优先使用 IPv4；如果仍失败，请检查服务器到 api.telegram.org 的网络/防火墙。';
  if (message.includes('Unauthorized')) return 'BOT_TOKEN 无效或填错。';
  if (message.includes('chat not found')) return 'OWNER_IDS 不是正确的 Telegram 数字 ID，或该账号还没有先打开 Bot 并发送 /start。';
  if (message.includes('bot was blocked')) return '这个 Telegram 账号屏蔽了 Bot，请先解除屏蔽并发送 /start。';
  if (message.includes('Forbidden')) return 'Bot 不能主动给这个账号发消息。请先用 OWNER_IDS 对应账号打开 Bot 并发送 /start。';
  return message;
}

function renderBackup(): string {
  const data = getBackupInstructions();
  return layout(`
    ${renderMainTabs('backup')}
    <section class="panel"><h2>备份 / 恢复</h2><p class="danger-text">不会从公网后台直接下载数据库；请在服务器或 Cloudflare 控制台按指引导出，避免泄露客户数据。</p><p class="muted">${esc(data.warning)}</p><h3>Node.js / Docker</h3><pre>${esc(data.node)}</pre><h3>Cloudflare D1</h3><pre>${esc(data.cloudflareD1)}</pre><h3>恢复建议</h3><p>${esc(data.restoreAdvice)}</p><p><a href="/admin?page=system">返回系统自检</a></p></section>
  `);
}

async function renderAudit(env: Env): Promise<string> {
  const data = await getAuditPanel(env);
  return layout(`
    ${renderMainTabs('audit', env, { role: 'owner' })}
    <section class="panel"><h2>后台操作审计</h2><p class="muted">仅记录操作类型、目标和脱敏摘要，不记录密码/API Key 明文。</p>${data.logs.map((x) => `<div class="row"><span class="muted">${esc(x.created_at)}</span><b>${esc(x.action)}</b><span>${esc(x.target ?? '')}</span><span class="badge ${x.status === 'failed' ? 'danger' : ''}">${esc(x.status)}</span><small>${esc(x.ip ?? '')} ${esc(x.detail ?? '')}</small></div>`).join('') || '<p class="muted">暂无审计记录</p>'}</section>
  `);
}

async function renderSystem(env: Env, request: Request, canWrite = true): Promise<string> {
  const status = await getSystemStatus(env, new URL(request.url).origin);
  return layout(`
    ${renderMainTabs('system', env)}
    <section class="panel"><h2>后台群配置</h2><p class="muted">用户私聊 Bot 后，系统会在这个 Telegram Forum 群里自动创建用户 Topic。群必须开启“话题 / Topics”，Bot 必须是管理员。</p><form method="POST" action="/admin" class="stack" data-api="/admin/api/settings">${csrfInput()}<input type="hidden" name="key" value="support_chat_id" /><input name="value" value="${esc(env.SUPPORT_CHAT_ID || '')}" placeholder="-1001234567890" /><button ${canWrite ? '' : 'disabled'}>保存后台群 ID</button></form><div class="hint"><b>怎么获取？</b><ol><li>把 Bot 拉进后台 Telegram 群，并设为管理员。</li><li>群设置里开启“话题 / Topics”。</li><li>在群里发送 <code>/setup</code>。</li><li>Bot 会回复 <code>当前群 ID</code>，复制 <code>-100...</code> 到这里。</li></ol></div></section>
    <section class="panel"><h2>安装自检 / 系统状态</h2>${status.checks.map((x) => `<div class="row"><b>${esc(x.key)}</b><span class="badge ${x.level === 'error' ? 'danger' : x.level === 'warn' ? 'warn' : ''}">${x.level === 'ok' ? 'OK' : x.level.toUpperCase()}</span><span>${esc(x.message)}</span></div>`).join('')}</section>
    <section class="panel"><h2>初始化向导</h2><p class="muted">用于一键写入默认欢迎语、限流设置、快捷回复和关键词回复。</p><form method="POST" action="/admin" data-api="/admin/api/install/basic" data-confirm="将写入默认欢迎语、限流设置、快捷回复和关键词回复，继续？">${csrfInput()}<button ${canWrite ? '' : 'disabled'}>应用基础初始化</button></form><h3>建议下一步</h3><ul>${status.nextSteps.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
    <section class="panel"><h2>安全提醒</h2><p>知识库默认关闭；不建议把原始 Telegram 历史聊天记录导入公网服务器。需要时请先离线脱敏。</p></section>
  `);
}

async function renderKnowledge(env: Env, q: string | undefined, canWrite = true): Promise<string> {
  const data = await getKnowledgePanel(env, q);
  return layout(`
    <nav class="tabs">${tab('users', '用户', 'knowledge')}${tab('pending', '待处理', 'knowledge')}${tab('replies', '话术', 'knowledge')}${tab('broadcasts', '广播', 'knowledge')}${tab('knowledge', '知识库', 'knowledge')}${tab('settings', '设置', 'knowledge')}</nav>
    <section class="panel"><h2>导入 Telegram JSON 原始素材</h2><p class="muted">建议从 Telegram Desktop 导出 JSON 后粘贴/上传内容。导入后先作为素材，不会直接等于可信知识。</p><form method="POST" action="/admin" class="stack">${csrfInput()}<input type="hidden" name="action" value="kb_import" /><input name="title" placeholder="导入批次标题，可空" /><textarea name="json" placeholder="粘贴 Telegram 导出的 result.json 内容"></textarea><button ${canWrite ? '' : 'disabled'}>导入素材</button></form></section>
    <section class="panel"><h2>知识条目</h2><form method="POST" action="/admin" class="stack">${csrfInput()}<input type="hidden" name="action" value="kb_entry" /><input name="title" placeholder="标题" /><textarea name="content" placeholder="确认后的知识内容"></textarea><input name="tags" placeholder="标签，逗号分隔" /><input name="source" placeholder="来源说明，可空" /><label><input type="checkbox" name="enabled" value="1" checked /> 启用</label><button ${canWrite ? '' : 'disabled'}>保存知识</button></form>${data.entries.map((x) => `<article class="broadcast"><div><b>${esc(x.title)}</b> <code>${esc(x.id)}</code> ${x.enabled ? '' : '<span class="badge danger">停用</span>'}</div><p class="muted">${esc(x.tags ?? '')} · ${esc(x.source ?? '')}</p><p>${esc(x.content)}</p><form method="POST" action="/admin" class="inline">${csrfInput()}<input type="hidden" name="action" value="kb_delete" /><input type="hidden" name="id" value="${esc(x.id)}" /><button class="secondary danger" ${canWrite ? '' : 'disabled'}>删除</button></form></article>`).join('') || '<p class="muted">暂无知识条目</p>'}</section>
    <section class="panel"><h2>原始素材</h2><form class="search" method="GET" action="/admin"><input type="hidden" name="page" value="knowledge" /><input name="q" value="${esc(q ?? '')}" placeholder="搜索素材/知识" /><button>搜索</button></form>${data.raw.map((x) => `<article class="broadcast"><div><code>#${esc(x.id)}</code> ${esc(x.sender_name ?? '')} <span class="muted">${esc(x.message_date ?? '')}</span></div><p>${esc(x.text)}</p></article>`).join('') || '<p class="muted">暂无原始素材</p>'}</section>
  `);
}

async function renderBots(env: Env, session: AdminSession, chrome = ''): Promise<string> {
  const data = await getBotPanel(env);
  const workspaceData = await getWorkspaceApiPanel(env);
  return layout(`
    ${chrome}
    ${renderMainTabs('bots', env, session)}
    <section class="two">
      <div class="panel"><div class="section-title"><h2>Workspace 列表</h2><span class="badge">${workspaceData.workspaces.length} 个</span></div>${workspaceData.workspaces.map((w) => renderWorkspaceCard(w, env)).join('') || '<div class="empty">暂无 Workspace</div>'}<form method="POST" action="/admin" class="stack" data-api="/admin/api/workspace">${csrfInput()}<input name="id" placeholder="workspace id，例如 default / brand-a" /><input name="name" placeholder="显示名称" /><button ${session.role === 'owner' ? '' : 'disabled'}>新建 / 保存 Workspace</button></form></div>
      <div class="panel"><div class="section-title"><h2>当前 Workspace 的 Bot</h2><span class="badge">${data.bots.length} 个</span></div><p class="muted">Token 加密保存，只显示 hint；默认 Bot 继续使用 <code>/telegram/webhook</code>，非默认 Bot 使用 <code>/telegram/webhook/&lt;botId&gt;</code>。</p>${data.bots.map((bot) => renderBotRow(bot, session.canWrite)).join('') || '<div class="empty">暂无 Bot</div>'}</div>
    </section>
    <section class="panel"><h2>新增 Bot</h2><p class="muted">只填 Bot 名称和 BotFather Token。系统会自动生成 Bot ID、Webhook Secret、安装 webhook，并标记为“等待绑定后台群”。</p><form method="POST" action="/admin" class="stack" data-api="/admin/api/bot/quick-activate">
      ${csrfInput()}
      <input name="name" placeholder="显示名称，例如 售前客服 Bot" />
      <input type="password" name="token" autocomplete="new-password" placeholder="BotFather 给你的 Bot Token" />
      <input name="support_chat_id" placeholder="高级项：手动绑定后台群 ID 才填 -100...；正常流程留空" />
      <label><input type="checkbox" name="is_default" value="1" /> 设为默认 Bot（一般不要勾）</label>
      <button ${session.role === 'owner' ? '' : 'disabled'}>创建 Bot 并安装 Webhook</button>
    </form>
    <div class="hint"><b>最终用户流程</b><ol><li>后台填 Bot 名称 + Bot Token，点创建。</li><li>把 Bot 拉进一个开启 Topics 的后台群，并设为管理员。</li><li>在群里发送 <code>/setup</code> 或 <code>/bind</code>。</li><li>Bot 回复绑定成功后，这个 Bot 的客户消息会进入该群的独立 Topic。</li></ol><p class="muted">安全规则：只有“等待绑定后台群”的 Bot 会接受第一次自动绑定；已绑定后再次 /setup 只显示状态，不会自动改绑。高级项里仍可手动填写后台群 ID。</p></div>
    <details class="hint"><summary><b>高级编辑 / 手动配置</b></summary><form method="POST" action="/admin" class="stack" data-api="/admin/api/bot">
      ${csrfInput()}
      <input name="id" placeholder="Bot ID，可留空自动生成；编辑已有 Bot 时填写原 ID" />
      <input name="name" placeholder="显示名称，例如 售前客服 Bot" />
      <input type="password" name="token" autocomplete="new-password" placeholder="Bot Token；留空表示保留旧 token" />
      <input name="webhook_secret" placeholder="Webhook Secret；留空则清空/按服务逻辑处理，不会回显" />
      <input name="public_url" value="${esc(env.PUBLIC_URL || '')}" placeholder="https://tg.example.com" />
      <input name="support_chat_id" placeholder="-100... 后台 Forum 群 ID" />
      <label><input type="checkbox" name="enabled" value="1" checked /> 启用这个 Bot</label>
      <label><input type="checkbox" name="is_default" value="1" /> 设为当前 Workspace 默认 Bot（默认 Bot 不能删除）</label>
      <button ${session.role === 'owner' ? '' : 'disabled'}>保存高级配置</button>
    </form></details></section>
  `);
}

function renderWorkspaceCard(w: WorkspaceRow, env?: Env): string {
  const active = w.id === (env?.WORKSPACE_ID || 'default');
  return `<article class="quick-card"><div class="section-title"><b>${esc(w.name)}</b>${active ? '<span class="badge ok">当前</span>' : ''}</div><p class="muted"><code>${esc(w.id)}</code> · ${esc(w.created_at || '')}</p><p><a href="/admin?page=bots&workspace=${encodeURIComponent(w.id)}&bot=default">切换查看 →</a></p></article>`;
}

function renderBotRow(bot: BotRow, canWrite: boolean): string {
  const webhookUrl = botWebhookUrl(bot.public_url, bot.id);
  const path = bot.id === 'default' ? '/telegram/webhook' : `/telegram/webhook/${bot.id}`;
  const bindHint = bot.support_chat_id
    ? `<span class="badge ok">已绑定后台群</span>`
    : `<span class="badge warn">未绑定后台群</span><p class="danger-text">请把 Bot 拉进目标 Forum 群，并发送 <code>/setup</code> 或 <code>/bind</code> 完成绑定。</p>`;
  return `<article class="broadcast"><div class="section-title"><div><b>${esc(bot.name)}</b> <code>${esc(bot.id)}</code> ${bot.is_default ? '<span class="badge">默认 Bot</span>' : ''} ${bot.enabled ? '<span class="badge ok">启用</span>' : '<span class="badge danger">停用</span>'} ${bindHint}</div></div><p class="muted">workspace: ${esc(bot.workspace_id)} · token hint: ${esc(bot.token_hint ?? '未配置')} · 后台群: ${esc(bot.support_chat_id ?? '未配置')}</p><p class="muted">Webhook path: <code>${esc(path)}</code></p><p class="muted">完整 URL: <code>${esc(webhookUrl || `请先配置 public_url，路径为 ${path}`)}</code></p><div class="ops"><form method="POST" action="/admin" data-api="/admin/api/install/webhook" data-confirm="将为当前 Bot 安装 Telegram webhook，请确认域名、Token、Secret 均已配置。">${csrfInput()}<button class="secondary" ${canWrite ? '' : 'disabled'}>安装 Webhook</button></form>${bot.id !== 'default' ? `<form method="POST" action="/admin" data-api="/admin/api/bot" data-confirm="确定删除这个 Bot？删除后该 Bot 的入口会失效，默认 Bot 不受影响。">${csrfInput()}<input type="hidden" name="delete" value="true" /><input type="hidden" name="id" value="${esc(bot.id)}" /><button class="secondary danger" ${canWrite ? '' : 'disabled'}>删除 Bot</button></form>` : '<span class="muted">默认 Bot 不能删除</span>'}</div></article>`;
}

async function renderSettings(env: Env, session: AdminSession, chrome = '', request?: Request): Promise<string> {
  const [data, status] = await Promise.all([getSettingsPanel(env), getSystemStatus(env, request ? new URL(request.url).origin : env.PUBLIC_URL || '')]);
  const rows = Object.entries(data.settings).map(([key, value]) => `
    <form method="POST" action="/admin" class="setting-row" data-api="/admin/api/settings">
      ${csrfInput()}
      <div><code>${esc(key)}</code><p class="muted">${esc(settingHelp(key))}</p>${key === 'ai_auto_reply' ? '<p class="danger-text">高风险：AI 自动回复会直接替客服发消息。涉及价格、退款、账号、安全问题建议只生成草稿，只有 owner 可开启。</p>' : ''}</div>
      <textarea name="value">${esc(value ?? '')}</textarea>
      ${key === 'ai_auto_reply' ? '<input name="confirm_value" placeholder="如要开启 true，请输入 ENABLE_AI_AUTO" />' : ''}
      <input type="hidden" name="key" value="${esc(key)}" />
      <button ${session.canWrite ? '' : 'disabled'}>保存</button>
    </form>`).join('');

  return layout(`
    ${chrome}
    ${renderMainTabs('settings', env, session)}
    <section class="two">
      <div class="panel"><h2>初始化向导</h2><p class="muted">适合第一次部署后使用：写入默认欢迎语、限流、基础快捷回复和关键词回复。</p><form method="POST" action="/admin" data-api="/admin/api/install/basic" data-confirm="将写入默认欢迎语、限流设置、快捷回复和关键词回复，继续？">${csrfInput()}<button ${session.role === 'owner' ? '' : 'disabled'}>应用基础初始化</button></form><h3>下一步建议</h3><ul>${status.nextSteps.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="panel"><h2>域名 / Webhook</h2><p class="muted">域名用于 Telegram 回调和后台访问。Webhook 安装前请确认 Bot Token 与 Secret 已配置。</p>${status.checks.map((x) => `<div class="row"><b>${esc(x.key)}</b><span class="badge ${x.level === 'error' ? 'danger' : x.level === 'warn' ? 'warn' : 'ok'}">${x.level === 'ok' ? 'OK' : x.level.toUpperCase()}</span><span>${esc(x.message)}</span></div>`).join('')}<form method="POST" action="/admin" class="stack" data-api="/admin/api/install/domain">${csrfInput()}<input name="domain" value="${esc(env.PUBLIC_URL || '')}" placeholder="https://tg.example.com" /><button ${session.role === 'owner' ? '' : 'disabled'}>保存域名</button></form><form method="POST" action="/admin" data-api="/admin/api/install/webhook" data-confirm="将调用 Telegram 设置 webhook，确认继续？">${csrfInput()}<button class="secondary" ${session.role === 'owner' ? '' : 'disabled'}>安装 Webhook</button></form></div>
    </section>
    <section class="panel"><h2>系统 Settings</h2><p class="muted">这些配置按当前 workspace / bot 隔离。后台 Forum 群 ID 必须是 <code>-100...</code>，群需要开启 Topics，Bot 需要管理员权限。</p>${rows}</section>
    <section class="panel"><h2>敏感词</h2><p class="muted">用于拦截或提醒客服注意高风险内容，支持换行或逗号批量添加。</p>${data.sensitiveWords.map((x) => `<form method="POST" action="/admin" class="pill" data-api="/admin/api/sensitive" data-confirm="删除这个敏感词？">${csrfInput()}<input type="hidden" name="delete" value="true" /><input type="hidden" name="word" value="${esc(x.word)}" /><span>${esc(x.word)}</span><button ${session.canWrite ? '' : 'disabled'}>×</button></form>`).join('') || '<p class="muted">暂无敏感词</p>'}<form method="POST" action="/admin" class="stack" data-api="/admin/api/sensitive">${csrfInput()}<textarea name="word" placeholder="新增敏感词，支持换行或逗号批量添加"></textarea><button ${session.canWrite ? '' : 'disabled'}>添加敏感词</button></form></section>
  `);
}

async function renderAi(env: Env, session: AdminSession, chrome = ''): Promise<string> {
  const data = await getAiConfigPanel(env);
  const owner = canManageAiProviders(session);
  return layout(`
    ${chrome}
    ${renderMainTabs('ai', env, session)}
    <section class="panel"><h2>AI 风险提示</h2><p class="danger-text">AI 建议默认只生成草稿，不要自动发送。API Key 不会完整回显；只有 owner 可以管理 Provider / API Key / 模型开关。</p></section>
    ${owner ? renderAiProviders(data.providers, session.canWrite) : '<section class="panel"><h2>Provider 管理</h2><p class="muted">只有 owner 可以管理 Provider/API Key。</p></section>'}
    <section class="panel"><div class="section-title"><h2>模型管理</h2><span class="badge">${data.models.length} 个模型</span></div>${data.models.map((m) => renderAiModelCard(m, owner)).join('') || '<div class="empty">暂无模型</div>'}</section>
  `);
}

function renderAiProviders(providers: AiProviderRow[], canWrite: boolean): string {
  return `<section class="panel"><div class="section-title"><h2>Provider 管理</h2><span class="badge">API: /admin/api/ai</span></div><p class="muted">支持 OpenAI-compatible 接口。拉取模型会调用 Provider 的 /models，错误信息会脱敏。</p>${providers.map((p) => `<article class="broadcast"><div class="section-title"><div><b>${esc(p.name)}</b> <code>${esc(p.id)}</code></div><span class="badge ${p.enabled ? 'ok' : 'danger'}">${p.enabled ? '启用' : '停用'}</span></div><p class="muted">${esc(p.base_url)} · key hint: ${esc(p.api_key_hint ?? '未配置')}</p><div class="ops"><button type="button" class="secondary" data-provider-models="${esc(p.id)}">拉取模型</button>${p.id !== 'env-default' ? `<form method="POST" action="/admin" data-api="/admin/api/ai-provider" data-confirm="确定删除这个 Provider？已导入模型可能不可用。">${csrfInput()}<input type="hidden" name="delete" value="true" /><input type="hidden" name="id" value="${esc(p.id)}" /><button class="secondary danger" ${canWrite ? '' : 'disabled'}>删除 Provider</button></form>` : ''}</div><div data-provider-out="${esc(p.id)}" class="model-list muted"></div><form method="POST" action="/admin" class="inline" data-api="/admin/api/ai-provider-import-model">${csrfInput()}<input type="hidden" name="provider_id" value="${esc(p.id)}" /><input name="model" placeholder="模型 ID" /><input name="name" placeholder="显示名称，可空" /><label><input type="checkbox" name="is_default" value="1" /> 默认</label><button ${canWrite ? '' : 'disabled'}>导入模型</button></form></article>`).join('') || '<div class="empty">暂无 Provider</div>'}<form method="POST" action="/admin" class="stack" data-api="/admin/api/ai-provider">${csrfInput()}<input name="id" placeholder="provider id，例如 openrouter" /><input name="name" placeholder="显示名称" /><input name="base_url" value="https://api.openai.com/v1" placeholder="Base URL" /><input type="password" name="api_key" autocomplete="new-password" placeholder="API Key；留空则保留旧 key" /><label><input type="checkbox" name="enabled" value="1" checked /> 启用</label><button ${canWrite ? '' : 'disabled'}>保存 Provider</button></form></section>`;
}

function renderAiModelCard(m: AiModelRow, owner: boolean): string {
  return `<article class="broadcast"><div class="section-title"><div><b>${esc(m.name)}</b> <code>${esc(m.id)}</code> ${m.is_default ? '<span class="badge">默认</span>' : ''}</div><span class="badge ${m.enabled ? 'ok' : 'danger'}">${m.enabled ? '启用' : '停用'}</span></div><p class="muted">provider: ${esc(m.provider_id ?? 'env')} · model: ${esc(m.model)} · key env: ${esc(m.api_key_env)}</p><p>${esc(m.system_prompt ?? '')}</p><div class="ops"><form method="POST" action="/admin" data-api="/admin/api/ai-model">${csrfInput()}<input type="hidden" name="set_default" value="true" /><input type="hidden" name="id" value="${esc(m.id)}" /><button class="secondary" ${owner ? '' : 'disabled'}>设为默认</button></form><form method="POST" action="/admin" data-api="/admin/api/ai-model">${csrfInput()}<input type="hidden" name="id" value="${esc(m.id)}" /><input type="hidden" name="enabled" value="${m.enabled ? '0' : '1'}" /><button class="secondary" ${owner ? '' : 'disabled'}>${m.enabled ? '停用' : '启用'}</button></form>${m.id !== 'default' ? `<form method="POST" action="/admin" data-api="/admin/api/ai-model" data-confirm="确定删除这个 AI 模型？">${csrfInput()}<input type="hidden" name="delete" value="true" /><input type="hidden" name="id" value="${esc(m.id)}" /><button class="secondary danger" ${owner ? '' : 'disabled'}>删除</button></form>` : ''}</div></article>`;
}

async function renderAdmins(env: Env, session: AdminSession, chrome = ''): Promise<string> {
  const [data, workspaceData] = await Promise.all([getAdminsPanel(env, session), getWorkspaceApiPanel(env)]);
  const owner = canManageAdmins(session);
  return layout(`
    ${chrome}
    ${renderMainTabs('admins', env, session)}
    <section class="panel"><h2>权限说明</h2><div class="cards"><div class="card"><b>owner</b><span>最高权限：管理管理员、Provider/API Key、安装配置</span></div><div class="card"><b>admin</b><span>可处理客服业务和常规配置，不能管理密钥</span></div><div class="card"><b>readonly</b><span>只读查看，不能写入</span></div></div></section>
    <section class="two">
      <div class="panel"><h2>全局管理员</h2>${data.admins.map((x) => `<form method="POST" action="/admin" class="pill" data-api="/admin/api/admin" data-confirm="确定删除这个全局管理员？">${csrfInput()}<input type="hidden" name="delete" value="true" /><input type="hidden" name="admin_id" value="${esc(x.user_id)}" /><span><code>${esc(x.user_id)}</code> ${esc(x.name ?? '')} <span class="badge">${esc(x.role)}</span></span><button ${owner ? '' : 'disabled'}>×</button></form>`).join('') || '<p class="muted">暂无数据库管理员；OWNER_IDS 环境变量仍可作为 owner 来源。</p>'}${owner ? `<form method="POST" action="/admin" class="stack" data-api="/admin/api/admin">${csrfInput()}<input name="admin_id" placeholder="Telegram 用户 ID" /><input name="name" placeholder="备注名" /><select name="role"><option value="admin">admin</option><option value="readonly">readonly</option><option value="owner">owner</option></select><button>添加全局管理员</button></form>` : '<p class="muted">只有 owner 可以管理管理员。</p>'}</div>
      <div class="panel"><h2>Workspace 管理员</h2><p class="muted">当前 Workspace：<code>${esc(env.WORKSPACE_ID || 'default')}</code></p>${workspaceData.admins.map((x: WorkspaceAdminRow) => `<form method="POST" action="/admin" class="pill" data-api="/admin/api/workspace-admin" data-confirm="确定移除这个 workspace 管理员？">${csrfInput()}<input type="hidden" name="delete" value="true" /><input type="hidden" name="workspace_id" value="${esc(x.workspace_id)}" /><input type="hidden" name="user_id" value="${esc(x.user_id)}" /><span><code>${esc(x.user_id)}</code> ${esc(x.name ?? '')} <span class="badge">${esc(x.role)}</span></span><button ${owner ? '' : 'disabled'}>×</button></form>`).join('') || '<p class="muted">暂无 Workspace 管理员</p>'}${owner ? `<form method="POST" action="/admin" class="stack" data-api="/admin/api/workspace-admin">${csrfInput()}<input name="workspace_id" value="${esc(env.WORKSPACE_ID || 'default')}" /><input name="user_id" placeholder="Telegram 用户 ID" /><input name="name" placeholder="备注名" /><select name="role"><option value="admin">admin</option><option value="readonly">readonly</option><option value="owner">owner</option></select><button>添加 Workspace 管理员</button></form>` : ''}</div>
    </section>
  `);
}


async function renderBroadcasts(env: Env, canWrite = true, chrome = ''): Promise<string> {
  const data = await getBroadcastPanel(env);
  return layout(`
    ${chrome}
    ${renderMainTabs('broadcasts', env)}
    <section class="workbench">
      <div class="panel">
        <h2>创建广播草稿</h2>
        <p class="muted">广播不会立即发送，会先创建草稿；必须在历史列表里二次确认。目标筛选建议先小范围测试。</p>
        <form method="POST" action="/admin" class="stack" data-api="/admin/api/broadcasts">
          ${csrfInput()}
          <select name="filter"><option value="all">全部用户</option><option value="tag">指定标签</option><option value="pending">待处理用户</option><option value="important">重要用户</option><option value="active_days">最近 N 天活跃</option></select>
          <input name="filter_value" placeholder="标签名或天数；全部/待处理/重要可留空" />
          <textarea name="text" placeholder="广播内容。请避免发送隐私、密钥、夸大承诺或不可撤回的通知。"></textarea>
          <button ${canWrite ? '' : 'disabled'}>创建草稿</button>
        </form>
      </div>
      <aside><section class="panel"><h2>预计目标</h2><div class="card"><b>${data.targetCount}</b><span>当前筛选目标用户</span></div><p class="danger-text">风险提示：广播会主动触达客户，确认前请检查目标范围、文案和链接。</p></section></aside>
    </section>
    <section class="panel"><div class="section-title"><h2>广播历史</h2><span class="badge">API: /admin/api/broadcasts</span></div>${data.broadcasts.length ? `<table class="data-table"><thead><tr><th>广播</th><th>状态</th><th>目标 / 成功 / 失败</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${data.broadcasts.map((x) => `<tr><td data-label="广播"><b>${esc(x.id)}</b><p>${esc(x.text)}</p><p class="muted">筛选：${esc(x.target_filter ?? 'all')}</p></td><td data-label="状态"><span class="badge ${x.status === 'draft' ? 'warn' : x.status === 'sent' ? 'ok' : 'danger'}">${esc(x.status)}</span></td><td data-label="目标 / 成功 / 失败">${esc(x.target_count ?? '-')} / ${esc(x.ok_count ?? '-')} / ${esc(x.failed_count ?? '-')}</td><td data-label="创建时间"><span class="muted">${esc(x.created_at)}</span></td><td data-label="操作"><div class="ops"><a href="/admin?page=broadcast&broadcast_id=${encodeURIComponent(x.id)}${tenantParam(env, '&')}">查看详情</a>${x.status === 'draft' ? `<form method="POST" action="/admin" data-api="/admin/api/broadcasts" data-confirm="高风险操作：确认后会向筛选到的客户发送广播，无法撤回。确定发送？">${csrfInput()}<input type="hidden" name="confirm" value="true" /><input type="hidden" name="id" value="${esc(x.id)}" /><button class="danger" ${canWrite ? '' : 'disabled'}>二次确认发送</button></form>` : ''}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无广播</div>'}</section>
  `);
}

async function renderBroadcastDetail(env: Env, id: string, chrome = ''): Promise<string> {
  const { broadcast, results } = await getBroadcastDetail(env, id);
  if (!broadcast) return layout(`${chrome}<p class="muted">找不到广播 <code>${esc(id)}</code></p><p><a href="/admin?page=broadcasts${tenantParam(env, '&')}">返回</a></p>`);
  return layout(`
    ${chrome}
    <p><a href="/admin?page=broadcasts${tenantParam(env, '&')}">← 返回广播列表</a></p>
    <section class="panel"><h2>广播详情 ${esc(broadcast.id)}</h2><p class="muted">状态：${esc(broadcast.status)} · 筛选：${esc(broadcast.target_filter ?? '全部')} · 目标：${esc(broadcast.target_count ?? '-')} · 成功：${esc(broadcast.ok_count ?? '-')} · 失败：${esc(broadcast.failed_count ?? '-')}</p><p>${esc(broadcast.text)}</p></section>
    <section class="panel"><h2>发送结果</h2>${results.map((x) => `<div class="row"><code>${esc(x.user_chat_id)}</code><span>${esc(x.status)}</span><span>${esc(x.error ?? '')}</span><span class="muted">${esc(x.sent_at)}</span></div>`).join('') || '<p class="muted">暂无逐用户发送结果。草稿未发送时这里为空。</p>'}</section>
  `);
}

function renderUsers(users: UserRow[], q: string | undefined, env?: Env): string {
  return `
    <div class="section-title"><div><h2>客户列表</h2><p class="muted">像 CRM 一样管理 Telegram 用户，待处理、重要、静音、拉黑一眼可见。</p></div><span class="badge">${users.length} 位客户</span></div>
    <form class="search" method="GET" action="/admin">
      ${env ? `<input type="hidden" name="workspace" value="${esc(env.WORKSPACE_ID || 'default')}" /><input type="hidden" name="bot" value="${esc(env.BOT_ID || 'default')}" />` : ''}
      <input name="q" value="${esc(q ?? '')}" placeholder="搜索 username / 名字 / Telegram ID / 标签" />
      <button>搜索客户</button>
    </form>
    <section class="panel">
      ${users.length ? `<form method="POST" action="/admin" data-api="/admin/api/users/bulk-delete" data-confirm="确定批量删除选中的会话？系统内客户资料、消息记录和映射会被清理。"><div class="ops" style="margin-bottom:10px"><button class="secondary danger">删除选中会话</button><span class="muted">勾选后可从列表外侧批量删除；删除前会在对应 Telegram Topic 里留下提示。</span></div><table class="data-table"><thead><tr><th><input type="checkbox" data-check-all="user_ids" title="全选" /></th><th>客户</th><th>状态</th><th>标签 / 备注</th><th>最后消息</th><th>操作</th></tr></thead><tbody>${users.map((u) => userRow(u, env)).join('')}</tbody></table></form>` : '<div class="empty">暂无用户。用户私聊 Bot 后会自动出现在这里。</div>'}
    </section>
    <section class="panel"><h2>批量清理会话</h2><p class="muted">适合清理很久没互动的会话。删除会清理系统内客户资料、消息记录和映射；不会删除 Telegram 群历史消息，但会在旧 Topic 里发一条“已删除/不再绑定”的提示。</p><form method="POST" action="/admin" class="stack" data-api="/admin/api/users/bulk-delete" data-confirm="确定按条件删除会话？此操作不可从后台恢复。">${csrfInput()}<label>删除最近多少天没有互动的会话<input name="older_than_days" inputmode="numeric" placeholder="例如 30，表示删除 30 天前最后互动的会话" /></label><label><input type="checkbox" name="all" value="true" /> 删除当前 Bot 下全部会话</label><input name="confirm_all" placeholder="如删除全部，请输入 DELETE_ALL" /><button class="secondary danger">执行清理</button></form></section>
  `;
}

function userRow(u: UserRow, env?: Env): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || u.user_chat_id;
  const tags = (u.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return `<tr>
    <td data-label="选择"><input type="checkbox" name="user_ids" value="${esc(u.user_chat_id)}" /></td>
    <td data-label="客户"><a class="user-title" href="/admin?page=user&id=${encodeURIComponent(u.user_chat_id)}${tenantParam(env, '&')}">${esc(name)}</a>${u.username ? `<div><a href="https://t.me/${esc(u.username)}" target="_blank" rel="noopener noreferrer">@${esc(u.username)}</a></div>` : ''}<div class="user-meta">ID: ${esc(u.user_chat_id)} · Topic: ${esc(u.topic_id ?? '-')}</div></td>
    <td data-label="状态"><div class="badges">${statusBadges(u)}</div></td>
    <td data-label="标签 / 备注"><div class="tags">${tags.map((tag) => tagPill(u.user_chat_id, tag)).join('') || '<span class="muted">无标签</span>'}</div><div class="user-meta">备注：${esc(u.note || '无')}</div><form method="POST" action="/admin" class="note-form" data-api="/admin/api/user">${csrfInput()}<input type="hidden" name="action" value="note" /><input type="hidden" name="user_id" value="${esc(u.user_chat_id)}" /><input name="note" value="${esc(u.note ?? '')}" placeholder="添加客服备注" /><button class="secondary">保存</button></form></td>
    <td data-label="最后消息"><span class="muted">${esc(u.last_message_at || u.updated_at || u.created_at || '-')}</span></td>
    <td data-label="操作"><div class="ops"><a class="secondary" style="display:inline-flex;border-radius:10px;padding:7px 9px;font-size:12px;font-weight:700;color:#344054" href="/admin?page=user&id=${encodeURIComponent(u.user_chat_id)}${tenantParam(env, '&')}">进入工单</a>${actionButton(u.user_chat_id, u.pending ? 'mark_replied' : 'mark_pending', u.pending ? '已处理' : '待处理')}${actionButton(u.user_chat_id, u.important ? 'unpin' : 'pin', u.important ? '取消重要' : '重要')}${actionButton(u.user_chat_id, u.is_blocked ? 'unblock' : 'block', u.is_blocked ? '解除拉黑' : '拉黑', u.is_blocked ? '' : 'danger')}</div></td>
  </tr>`;
}

function userCard(u: UserRow, detail = false, env?: Env): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || u.user_chat_id;
  const link = u.username ? `https://t.me/${u.username}` : `tg://user?id=${u.user_chat_id}`;
  const tags = (u.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return `
    <article class="user">
      <div class="user-head">
        <div>
          <div class="user-title">${esc(name)}</div>
          <div>${u.username ? `<a href="https://t.me/${esc(u.username)}" target="_blank" rel="noopener noreferrer">@${esc(u.username)}</a>` : '<span class="muted">无 username</span>'}</div>
          <div class="user-meta">Telegram ID: ${esc(u.user_chat_id)} · Topic: ${esc(u.topic_id ?? '-')} · 状态: ${esc(u.status ?? 'open')}</div>
        </div>
        <div class="badges">${statusBadges(u)}</div>
      </div>
      <div class="user-body">
        <div class="tags">${tags.map((tag) => tagPill(u.user_chat_id, tag)).join('') || '<span class="muted">无标签</span>'}</div>
        <p class="muted">备注：${esc(u.note || '无')}</p>
        <p><a href="${esc(link)}" rel="noopener noreferrer">打开 Telegram 联系链接</a>${detail ? '' : ` · <a href="/admin?page=user&id=${encodeURIComponent(u.user_chat_id)}${tenantParam(env, '&')}">进入工单</a>`}</p>
        <form method="POST" action="/admin" class="note-form" data-api="/admin/api/user">
          ${csrfInput()}<input type="hidden" name="action" value="note" /><input type="hidden" name="user_id" value="${esc(u.user_chat_id)}" />
          <input name="note" value="${esc(u.note ?? '')}" placeholder="客服备注，例如：已报价 / 等待付款" /><button>保存备注</button>
        </form>
        <form method="POST" action="/admin" class="tag-form" data-api="/admin/api/user">
          ${csrfInput()}<input type="hidden" name="action" value="tag" /><input type="hidden" name="user_id" value="${esc(u.user_chat_id)}" />
          <input name="tag" placeholder="新增标签，例如 VIP / 售后 / 高意向" /><button class="secondary">加标签</button>
        </form>
        <div class="actions">
          ${actionButton(u.user_chat_id, u.pending ? 'mark_replied' : 'mark_pending', u.pending ? '标记已处理' : '标记待处理')}
          ${actionButton(u.user_chat_id, u.status === 'closed' ? 'open' : 'close', u.status === 'closed' ? '重新打开' : '关闭会话')}
          ${actionButton(u.user_chat_id, u.important ? 'unpin' : 'pin', u.important ? '取消重要' : '标为重要')}
          ${actionButton(u.user_chat_id, u.muted ? 'unmute' : 'mute', u.muted ? '取消静音' : '静音')}
          ${actionButton(u.user_chat_id, u.ai_mode === 'auto' ? 'ai_off' : 'ai_on', u.ai_mode === 'auto' ? 'AI 手动' : 'AI 自动')}
          ${actionButton(u.user_chat_id, u.is_blocked ? 'unblock' : 'block', u.is_blocked ? '解除拉黑' : '拉黑', u.is_blocked ? '' : 'danger')}
        </div>
      </div>
    </article>
  `;
}

function statusBadges(u: UserRow): string {
  return `${u.pending ? '<span class="badge warn">待处理</span>' : '<span class="badge ok">已处理</span>'}
    ${u.important ? '<span class="badge">重要</span>' : ''}
    ${u.muted ? '<span class="badge muted-badge">静音</span>' : ''}
    ${u.is_blocked ? '<span class="badge danger">拉黑</span>' : ''}
    ${u.ai_mode === 'auto' ? '<span class="badge ai">AI 自动</span>' : ''}
    ${u.status === 'closed' ? '<span class="badge muted-badge">已关闭</span>' : ''}`;
}

function tagPill(userId: string, tag: string): string {
  return `<form method="POST" action="/admin" class="pill" data-api="/admin/api/user">${csrfInput()}<input type="hidden" name="action" value="untag" /><input type="hidden" name="user_id" value="${esc(userId)}" /><input type="hidden" name="tag" value="${esc(tag)}" /><span>${esc(tag)}</span><button title="删除标签">×</button></form>`;
}

function actionButton(userId: string, action: UserAction, label: string, cls = ''): string {
  return `<form method="POST" action="/admin" data-api="/admin/api/user">${csrfInput()}<input type="hidden" name="action" value="user:${esc(action)}" /><input type="hidden" name="user_id" value="${esc(userId)}" /><button class="secondary ${cls}">${esc(label)}</button></form>`;
}

function renderReplies(quick: QuickReplyRow[], keywords: KeywordReplyRow[], env?: Env, canWrite = true): string {
  return `
    <section class="section-title"><div><h2>客服话术库</h2><p class="muted">快捷回复给人工客服提速；关键词回复会自动命中用户消息，请保持简短、可控。</p></div><span class="badge">API: /admin/api/replies</span></section>
    <section class="two">
      <div class="panel">
        <div class="section-title"><h2>快捷回复</h2><span class="badge">${quick.length} 条</span></div>
        ${quick.map((x) => `<article class="quick-card"><div class="section-title"><b><code>${esc(x.key)}</code></b><span class="badge ok">启用</span></div><p>${esc(x.text)}</p><form method="POST" action="/admin" data-api="/admin/api/quick-replies" data-confirm="确定删除这条快捷回复？">${csrfInput()}<input type="hidden" name="delete" value="true" /><input type="hidden" name="key" value="${esc(x.key)}" /><button class="secondary danger" ${canWrite ? '' : 'disabled'}>删除快捷回复</button></form></article>`).join('') || '<div class="empty">暂无快捷回复</div>'}
        <form method="POST" action="/admin" class="stack" data-api="/admin/api/quick-replies">
          ${csrfInput()}
          <input name="key" placeholder="快捷键，例如 price / hello / done" />
          <textarea name="text" placeholder="客服发送给客户的标准回复内容"></textarea>
          <button ${canWrite ? '' : 'disabled'}>保存快捷回复</button>
        </form>
      </div>
      <div class="panel">
        <div class="section-title"><h2>关键词自动回复</h2><span class="badge">${keywords.length} 条</span></div>
        ${keywords.map((x) => `<article class="quick-card"><div class="section-title"><b>${esc(x.keyword)}</b><span class="badge ${x.enabled ? 'ok' : 'muted-badge'}">${x.enabled ? '启用' : '停用'}</span></div><p>${esc(x.reply)}</p><p class="muted">匹配方式：${esc(x.match_mode || 'contains')}</p><div class="ops"><form method="POST" action="/admin" data-api="/admin/api/keywords">${csrfInput()}<input type="hidden" name="keyword" value="${esc(x.keyword)}" /><input type="hidden" name="enabled" value="${x.enabled ? '0' : '1'}" /><button class="secondary" ${canWrite ? '' : 'disabled'}>${x.enabled ? '停用' : '启用'}</button></form><form method="POST" action="/admin" data-api="/admin/api/keywords" data-confirm="确定删除这个关键词回复？">${csrfInput()}<input type="hidden" name="delete" value="true" /><input type="hidden" name="keyword" value="${esc(x.keyword)}" /><button class="secondary danger" ${canWrite ? '' : 'disabled'}>删除</button></form></div></article>`).join('') || '<div class="empty">暂无关键词回复</div>'}
        <form method="POST" action="/admin" class="stack" data-api="/admin/api/keywords">
          ${csrfInput()}
          <input name="keyword" placeholder="关键词，例如 价格 / 付款 / 售后" />
          <textarea name="reply" placeholder="自动回复内容。建议只做引导，不做高风险承诺。"></textarea>
          <button ${canWrite ? '' : 'disabled'}>保存关键词回复</button>
        </form>
      </div>
    </section>
  `;
}

function settingHelp(key: string): string {
  const helps: Record<string, string> = {
    welcome_message: '用户发送 /start 时收到的欢迎语。',
    closed_message: '已关闭会话被用户重新打开时的提示。',
    rate_limit_count: '用户限流次数，必须是正整数。',
    rate_limit_window_seconds: '限流时间窗口秒数，必须是正整数。',
    ai_auto_reply: '全局 AI 自动回复开关：true/false。建议默认 false。',
    ai_base_url: 'OpenAI 兼容接口地址。',
    ai_model: 'AI 草稿/回复使用的模型名。',
    ai_system_prompt: 'AI 生成客服草稿时使用的系统提示。',
    broadcast_confirm_ttl_seconds: '广播二次确认有效期秒数。',
    support_chat_id: '后台 Forum 群 ID。初始化后把 bot 拉进后台群，群里发送 /setup 获取。',
    pending_tracking_enabled: '待跟进/已处理状态开关：true/false。关闭后用户消息不再自动标待处理，客服回复也不再要求点已处理。',
    support_message_panel_enabled: '每条用户消息下方快捷按钮开关：true/false。关闭后群里消息更清爽。',
    support_topic_delete_mode: '删除会话后的 Telegram Topic 处理：notify=只提示；close=提示并关闭话题；delete=直接删除话题。',
    support_notification_mode: '新消息摘要提醒模式：off=关闭；digest=每条客户新消息在后台群发一条轻量摘要，带打开会话按钮。',
    support_digest_thread_id: '摘要提醒发到哪个 Topic。留空则发到后台群普通流；填写某个 Topic/thread id 则集中发到该话题。',
  };
  return helps[key] ?? '系统设置';
}

async function adminChrome(rootEnv: Env, env: Env, currentBot: BotRow | null, page: string): Promise<string> {
  const bots = (await listBots(rootEnv.DB, env.WORKSPACE_ID || 'default')).filter((bot) => bot.enabled === 1);
  const selected = env.BOT_ID || currentBot?.id || 'default';
  const options = bots.map((bot) => `<option value="${esc(bot.id)}" ${bot.id === selected ? 'selected' : ''}>${esc(bot.name)} (${esc(bot.id)})</option>`).join('');
  const workspace = env.WORKSPACE_ID || currentBot?.workspace_id || 'default';
  return `<section class="panel tenant-bar"><div><b>当前工作区 / Bot</b><p class="muted">所有列表、话术、广播和设置都会按 tenant 隔离。</p></div><form method="GET" action="/admin" class="inline"><input type="hidden" name="page" value="${esc(page)}" /><input type="hidden" name="workspace" value="${esc(workspace)}" /><span class="tenant-chip">Workspace <code>${esc(workspace)}</code></span><label class="muted">Bot</label><select name="bot" onchange="this.form.submit()">${options}</select><button>切换</button></form></section>`;
}

function tenantParam(env?: Env, prefix = '?'): string {
  const bot = env?.BOT_ID;
  const workspace = env?.WORKSPACE_ID;
  const params = new URLSearchParams();
  if (workspace) params.set('workspace', workspace);
  if (bot) params.set('bot', bot);
  const text = params.toString();
  return text ? `${prefix}${text}` : '';
}

function tenantQuery(env?: Env): string {
  return tenantParam(env, '?');
}

function renderMainTabs(page: string, env?: Env, session?: Pick<AdminSession, 'role'>): string {
  return `<nav class="tabs">
    ${tab('dashboard', '首页', page, env)}
    ${tab('users', '客户', page, env)}
    ${tab('pending', '待处理', page, env)}
    ${tab('replies', '话术', page, env)}
    ${tab('broadcasts', '广播', page, env)}
    ${tab('bots', 'Bot 管理', page, env)}
    ${tab('settings', '设置', page, env)}
    ${tab('ai', 'AI', page, env)}
    ${tab('admins', '管理员', page, env)}
    ${tab('system', '系统状态', page, env)}
    ${tab('domain', '域名 HTTPS', page, env)}
    ${tab('backup', '备份', page, env)}
    ${session?.role === 'owner' || page === 'audit' ? tab('audit', '审计', page, env) : ''}
  </nav>`;
}

function tab(id: string, name: string, page: string, env?: Env): string {
  const labels: Record<string, string> = { dashboard: '首页', users: '客户', pending: '待处理', replies: '话术', broadcasts: '广播', bots: 'Bot 管理', settings: '设置', ai: 'AI', admins: '管理员', system: '系统状态', domain: '域名 HTTPS', backup: '备份', audit: '审计', knowledge: '知识库' };
  return `<a class="${page === id ? 'active' : ''}" href="/admin?page=${id}${tenantParam(env, '&')}">${esc(labels[id] ?? name)}</a>`;
}
