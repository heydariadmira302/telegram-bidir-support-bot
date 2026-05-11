import {
  addModelFromProvider,
  addSensitive,
  applyBasicInstallPreset,
  applyUserAction,
  createBroadcastDraft,
  draftAiReplyForUser,
  fetchProviderModels,
  getBroadcastPanel,
  getAdminsPanel,
  getAiConfigPanel,
  getAuditPanel,
  getBackupInstructions,
  getDashboard,
  getSettingsPanel,
  getSystemStatus,
  getSupportQueue,
  getSupportWorkbench,
  getWorkbenchStats,
  getUserDetail,
  getUserStats,
  getWorkspaceApiPanel,
  removeBot,
  removeKeyword,
  removeQuick,
  removeSensitive,
  removeUserConversation,
  removeUserConversations,
  removeWorkspaceAdmin,
  removeAdminUser,
  saveDomainConfig,
  removeAiModel,
  removeAiProvider,
  saveAdmin,
  saveAiModel,
  saveAiProvider,
  quickActivateBot,
  saveBot,
  saveKeyword,
  saveQuick,
  saveWorkspace,
  saveWorkspaceAdmin,
  sendBroadcastDraft,
  sendDirectReply,
  sendQuickReplyToUser,
  setupTelegramWebhook,
  toggleAiModel,
  toggleKeyword,
  updateSetting,
  useAiModel,
  type UserAction,
} from './service';
import { validCsrf } from './admin-auth';
import { assertCanWrite, assertOwner, getAdminSession } from './admin-permissions';
import { esc, noStoreJson } from './admin-render';
import type { BroadcastTargetFilter, Env } from './types';

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/admin/api/dashboard') return noStoreJson(await getDashboard(env, url.searchParams.get('q') ?? undefined));
  if (request.method === 'GET' && url.pathname === '/admin/api/users') return noStoreJson({ ok: true, ...(await getDashboard(env, url.searchParams.get('q') ?? undefined)) });
  if (request.method === 'GET' && (url.pathname === '/admin/api/replies' || url.pathname === '/admin/api/quick-replies' || url.pathname === '/admin/api/keywords')) {
    const data = await getDashboard(env, url.searchParams.get('q') ?? undefined);
    return noStoreJson({ ok: true, quick: data.quick, keywords: data.keywords });
  }
  if (request.method === 'GET' && url.pathname === '/admin/api/settings') return noStoreJson({ ok: true, ...(await getSettingsPanel(env)) });
  if (request.method === 'GET' && (url.pathname === '/admin/api/install/status' || url.pathname === '/admin/api/system/status')) return noStoreJson({ ok: true, ...(await getSystemStatus(env, url.origin)) });
  if (request.method === 'GET' && url.pathname === '/admin/api/backup/instructions') return noStoreJson({ ok: true, ...getBackupInstructions() });
  if (request.method === 'GET' && url.pathname === '/admin/api/audit-logs') {
    const session = await getAdminSession(request, env);
    assertOwner(session);
    return noStoreJson({ ok: true, ...(await getAuditPanel(env)) });
  }
  if (request.method === 'GET' && url.pathname === '/admin/api/admins') return noStoreJson({ ok: true, ...(await getAdminsPanel(env, await getAdminSession(request, env))) });
  if (request.method === 'GET' && (url.pathname === '/admin/api/ai' || url.pathname === '/admin/api/ai-providers' || url.pathname === '/admin/api/ai-models')) return noStoreJson({ ok: true, ...(await getAiConfigPanel(env)) });
  if (request.method === 'GET' && url.pathname === '/admin/api/workspaces') return noStoreJson({ ok: true, ...(await getWorkspaceApiPanel(env)) });
  if (request.method === 'GET' && url.pathname === '/admin/api/bots') return noStoreJson({ ok: true, ...(await getWorkspaceApiPanel(env)) });
  if (request.method === 'GET' && url.pathname === '/admin/api/broadcasts') return noStoreJson(await getBroadcastPanel(env, broadcastFilterFromInput(url.searchParams.get('filter') ?? 'all', url.searchParams.get('filter_value') ?? '')));
  if (request.method === 'GET' && url.pathname === '/admin/api/workbench') return noStoreJson({ ok: true, summary: await getSupportWorkbench(env), stats: await getWorkbenchStats(env) });
  if (request.method === 'GET' && url.pathname === '/admin/api/workbench/stats') return noStoreJson({ ok: true, stats: await getWorkbenchStats(env) });
  if (request.method === 'GET' && url.pathname === '/admin/api/queue') {
    const kind = url.searchParams.get('kind') ?? 'pending';
    if (kind !== 'pending' && kind !== 'important' && kind !== 'overdue' && kind !== 'recent') return noStoreJson({ ok: false, error: 'invalid queue kind' }, 400);
    return noStoreJson({ ok: true, ...(await getSupportQueue(env, kind)) });
  }
  if (request.method === 'GET' && url.pathname === '/admin/api/user') {
    const id = url.searchParams.get('id');
    if (!id) return noStoreJson({ ok: false, error: 'id is required' }, 400);
    const data = await getUserDetail(env, id);
    return noStoreJson({ ok: true, ...data, html: renderApiTimelineMessages(data.logs) });
  }
  if (request.method === 'GET' && url.pathname === '/admin/api/user/stats') {
    const id = url.searchParams.get('id') ?? url.searchParams.get('user_id');
    if (!id) return noStoreJson({ ok: false, error: 'id is required' }, 400);
    return noStoreJson({ ok: true, ...(await getUserStats(env, id)) });
  }

  if (request.method !== 'POST') return noStoreJson({ ok: false, error: 'Method not allowed' }, 405);
  if (!validCsrf(request)) return noStoreJson({ ok: false, error: 'Invalid CSRF token' }, 403);

  const payload = await readPayload(request);

  try {
    const session = await getAdminSession(request, env);
    assertCanWrite(session);
    if (url.pathname === '/admin/api/admin') {
      assertOwner(session);
      if (asBool(payload.delete)) await removeAdminUser(env, String(payload.admin_id ?? payload.user_id ?? ''));
      else await saveAdmin(env, String(payload.admin_id ?? payload.user_id ?? ''), String(payload.name ?? ''), String(payload.role ?? 'admin'));
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/install/basic') {
      assertOwner(session);
      await applyBasicInstallPreset(env);
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/install/domain' || url.pathname === '/admin/api/domain') {
      assertOwner(session);
      await saveDomainConfig(env, { domain: String(payload.domain ?? payload.public_url ?? '') });
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/install/webhook' || url.pathname === '/admin/api/webhook') {
      assertOwner(session);
      const webhookUrl = await setupTelegramWebhook(env);
      return noStoreJson({ ok: true, webhookUrl });
    }
    if (url.pathname === '/admin/api/ai-provider') {
      assertOwner(session);
      if (asBool(payload.delete)) await removeAiProvider(env, String(payload.id ?? payload.provider_id ?? ''));
      else await saveAiProvider(env, { id: String(payload.id ?? ''), name: String(payload.name ?? ''), base_url: String(payload.base_url ?? ''), api_key: String(payload.api_key ?? ''), enabled: payload.enabled === undefined ? 1 : asBool(payload.enabled) ? 1 : 0 });
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/ai-model') {
      assertOwner(session);
      if (asBool(payload.delete)) await removeAiModel(env, String(payload.id ?? ''));
      else if (asBool(payload.set_default)) await useAiModel(env, String(payload.id ?? ''));
      else if (payload.enabled !== undefined && !payload.name && !payload.model) await toggleAiModel(env, String(payload.id ?? ''), asBool(payload.enabled));
      else await saveAiModel(env, { id: String(payload.id ?? ''), provider_id: payload.provider_id == null ? null : String(payload.provider_id), name: String(payload.name ?? ''), base_url: String(payload.base_url ?? ''), model: String(payload.model ?? ''), api_key_env: String(payload.api_key_env ?? 'AI_API_KEY'), system_prompt: String(payload.system_prompt ?? ''), enabled: payload.enabled === undefined ? 1 : asBool(payload.enabled) ? 1 : 0, is_default: asBool(payload.is_default) ? 1 : 0 });
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/ai-provider-import-model') {
      assertOwner(session);
      await addModelFromProvider(env, String(payload.provider_id ?? ''), String(payload.model ?? ''), String(payload.name ?? ''), asBool(payload.is_default));
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/workspace') {
      assertOwner(session);
      await saveWorkspace(env, { id: String(payload.id ?? ''), name: String(payload.name ?? '') });
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/workspace-admin') {
      assertOwner(session);
      if (payload.delete) await removeWorkspaceAdmin(env, String(payload.workspace_id ?? env.WORKSPACE_ID ?? ''), String(payload.user_id ?? ''));
      else await saveWorkspaceAdmin(env, { workspaceId: String(payload.workspace_id ?? env.WORKSPACE_ID ?? ''), userId: String(payload.user_id ?? ''), name: String(payload.name ?? ''), role: String(payload.role ?? 'admin') });
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/bot' || url.pathname === '/admin/api/bot/quick-activate') {
      assertOwner(session);
      if (asBool(payload.delete)) await removeBot(env, String(payload.id ?? ''));
      else if (url.pathname.endsWith('/quick-activate') || asBool(payload.quick_activate)) {
        const result = await quickActivateBot(env, { name: String(payload.name ?? ''), token: String(payload.token ?? ''), supportChatId: String(payload.support_chat_id ?? ''), publicUrl: String(payload.public_url ?? ''), isDefault: asBool(payload.is_default) });
        return noStoreJson({ ok: true, ...result });
      }
      else await saveBot(env, { id: String(payload.id ?? ''), name: String(payload.name ?? ''), token: String(payload.token ?? ''), webhookSecret: String(payload.webhook_secret ?? ''), publicUrl: String(payload.public_url ?? ''), supportChatId: String(payload.support_chat_id ?? ''), enabled: payload.enabled === undefined ? true : asBool(payload.enabled), isDefault: asBool(payload.is_default) });
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/user-action' || url.pathname === '/admin/api/user') {
      if (asBool(payload.delete) || String(payload.action ?? '') === 'delete') {
        const result = await removeUserConversation(env, String(payload.user_id ?? payload.id ?? ''));
        return noStoreJson({ ok: true, message: `已删除 ${result.deleted} 个会话`, ...result });
      }
      const normalized = normalizeUserActionPayload(payload);
      await applyUserAction(env, normalized.userId, normalized.action, normalized.value);
      return noStoreJson({ ok: true });
    }

    if (url.pathname === '/admin/api/users/bulk-delete') {
      const idsRaw = payload.user_ids ?? payload.ids ?? '';
      const userIds = Array.isArray(idsRaw) ? idsRaw.map(String) : String(idsRaw).split(/[\n, ]+/);
      const olderThanDays = Number(payload.older_than_days || 0);
      const all = asBool(payload.all);
      if (!userIds.filter(Boolean).length && !olderThanDays && !all) return noStoreJson({ ok: false, error: '请选择会话，或填写清理天数，或勾选删除全部' }, 400);
      if (all && String(payload.confirm_all ?? '') !== 'DELETE_ALL') return noStoreJson({ ok: false, error: '删除全部需要输入 DELETE_ALL' }, 400);
      const result = await removeUserConversations(env, { userIds, olderThanDays, all });
      return noStoreJson({ ok: true, message: `已删除 ${result.deleted} 个会话`, ...result });
    }
    if (url.pathname === '/admin/api/quick' || url.pathname === '/admin/api/reply' || url.pathname === '/admin/api/quick-replies' || url.pathname === '/admin/api/replies') {
      if (asBool(payload.delete)) await removeQuick(env, String(payload.key ?? ''));
      else await saveQuick(env, String(payload.key ?? ''), String(payload.text ?? ''));
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/keyword' || url.pathname === '/admin/api/keywords') {
      if (asBool(payload.delete)) await removeKeyword(env, String(payload.keyword ?? ''));
      else if (payload.enabled !== undefined) await toggleKeyword(env, String(payload.keyword ?? ''), asBool(payload.enabled));
      else await saveKeyword(env, String(payload.keyword ?? ''), String(payload.reply ?? ''));
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/setting' || url.pathname === '/admin/api/settings') {
      await updateSetting(env, String(payload.key ?? ''), String(payload.value ?? ''));
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/sensitive') {
      if (asBool(payload.delete)) await removeSensitive(env, String(payload.word ?? ''));
      else await addSensitive(env, String(payload.word ?? ''));
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/ai-provider-import-models') {
      assertOwner(session);
      const providerId = String(payload.provider_id ?? '');
      const models = Array.isArray(payload.models) ? payload.models.map(String) : [];
      for (const model of models) await addModelFromProvider(env, providerId, model, model, asBool(payload.is_default));
      return noStoreJson({ ok: true, count: models.length });
    }
    if (url.pathname === '/admin/api/ai-provider-models') {
      assertOwner(session);
      return noStoreJson({ ok: true, models: await fetchProviderModels(env, String(payload.provider_id ?? '')) });
    }
    if (url.pathname === '/admin/api/ai-draft') {
      const draft = await draftAiReplyForUser(env, String(payload.user_id ?? ''), String(payload.prompt ?? ''));
      return noStoreJson({ ok: true, draft });
    }
    if (url.pathname === '/admin/api/direct-reply') {
      if (payload.quick_key) await sendQuickReplyToUser(env, String(payload.user_id ?? ''), String(payload.quick_key ?? ''));
      else await sendDirectReply(env, String(payload.user_id ?? ''), String(payload.text ?? ''));
      return noStoreJson({ ok: true });
    }
    if (url.pathname === '/admin/api/broadcast' || url.pathname === '/admin/api/broadcasts') {
      if (asBool(payload.confirm)) {
        const result = await sendBroadcastDraft(env, String(payload.id ?? ''));
        return noStoreJson({ success: true, ...result });
      }
      const draft = await createBroadcastDraft(env, String(payload.text ?? ''), 'web-admin', broadcastFilterFromInput(String(payload.filter ?? 'all'), String(payload.filter_value ?? payload.tag ?? '')));
      return noStoreJson({ ok: true, ...draft });
    }
    return noStoreJson({ ok: false, error: 'Not found' }, 404);
  } catch (err) {
    return noStoreJson({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, 400);
  }
}

function renderApiTimelineMessages(logs: Array<{ id?: number | null; direction: string; created_at: string; text?: string | null; media_type?: string | null; file_id?: string | null; file_name?: string | null; duration?: number | null }>): string {
  return logs.map((x) => `<div class="msg ${x.direction === 'in' ? 'in' : 'out'}" data-log-id="${esc(x.id ?? '')}"><b>${x.direction === 'in' ? '用户' : '客服'}</b><span>${esc(x.created_at)}</span>${renderApiMessageLogContent(x)}</div>`).join('') || '<div class="empty">暂无消息记录</div>';
}

function renderApiMessageLogContent(log: { id?: number | null; text?: string | null; media_type?: string | null; file_id?: string | null; file_name?: string | null; duration?: number | null }): string {
  const parts: string[] = [];
  if ((log.media_type === 'voice' || log.media_type === 'audio') && log.file_id) {
    const src = `/admin/file/${encodeURIComponent(String(log.id ?? log.file_id))}`;
    const title = log.media_type === 'voice' ? '语音消息' : '音频消息';
    parts.push(`<p><b>${title}</b>${log.file_name ? ` · ${esc(log.file_name)}` : ''}${log.duration ? ` · ${esc(log.duration)} 秒` : ''}</p><audio controls preload="metadata" src="${src}"></audio><p class="muted"><a href="${src}" target="_blank" rel="noopener noreferrer">打不开就点这里播放/下载</a></p>`);
  }
  if (log.text) parts.push(`<p>${esc(log.text)}</p>`);
  if (!parts.length) parts.push('<p class="muted">暂不支持预览的消息类型</p>');
  return parts.join('');
}

export function broadcastFilterFromInput(type: string, value: string): BroadcastTargetFilter {
  if (type === 'tag' || type === 'pending' || type === 'important' || type === 'active_days') return { type, value: value.trim() };
  return { type: 'all' };
}

async function readPayload(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return await request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

function normalizeUserActionPayload(payload: Record<string, unknown>): { userId: string; action: UserAction; value?: string } {
  const userId = String(payload.user_id ?? '');
  const rawAction = String(payload.action ?? '');
  const action = rawAction.startsWith('user:') ? rawAction.slice(5) : rawAction;
  const value = payload.value ?? payload.note ?? payload.tag;

  if (action === 'tag') return { userId, action: 'tag_add', value: value == null ? undefined : String(value) };
  if (action === 'untag') return { userId, action: 'tag_remove', value: value == null ? undefined : String(value) };
  return { userId, action: action as UserAction, value: value == null ? undefined : String(value) };
}

function asBool(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const text = String(value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}
