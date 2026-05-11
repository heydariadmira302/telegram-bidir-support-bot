import {
  addModelFromProvider,
  addSensitive,
  applyUserAction,
  createBroadcastDraft,
  draftAiReplyForUser,
  importTelegramJsonKnowledge,
  removeAdminUser,
  removeAiModel,
  removeAiProvider,
  removeKnowledgeEntry,
  removeKeyword,
  removeQuick,
  removeSensitive,
  removeUserConversation,
  runSetupWizard,
  removeBot,
  saveAdmin,
  saveBot,
  saveAiModel,
  saveAiProvider,
  saveKnowledgeEntry,
  saveKeyword,
  saveQuick,
  sendBroadcastDraft,
  sendDirectReply,
  sendQuickReplyToUser,
  toggleKeyword,
  updateSetting,
  useAiModel,
  writeAuditLog,
  type UserAction,
} from './service';
import { saveDomainConfig, setupTelegramWebhook } from './services/domain';
import { loginClientId, validCsrf } from './admin-auth';
import { assertCanWrite, assertOwner, getAdminSession } from './admin-permissions';
import { addFlash, htmlPage } from './admin-render';
import { broadcastFilterFromInput } from './admin-api';
import type { Env } from './types';

export async function handlePost(request: Request, env: Env, renderUserDetail: (env: Env, userId: string, aiDraft?: string) => Promise<string>): Promise<Response> {
  const form = await request.formData();
  if (!validCsrf(request, form)) return new Response('Invalid CSRF token', { status: 403 });
  const action = String(form.get('action') ?? '');
  const userId = String(form.get('user_id') ?? '');
  const audit = auditContext(request, action, userId || String(form.get('id') ?? form.get('key') ?? form.get('keyword') ?? form.get('provider_id') ?? form.get('admin_id') ?? ''));

  try {
    const session = await getAdminSession(request, env);
    assertCanWrite(session);

    if (['ai_provider', 'ai_provider_delete', 'ai_provider_import_model', 'admin_add', 'admin_delete', 'domain_save', 'caddy_apply', 'webhook_setup', 'bot_save', 'bot_delete'].includes(action)) assertOwner(session);
    if (action === 'setting' && String(form.get('key') ?? '') === 'ai_auto_reply' && String(form.get('value') ?? '') === 'true') assertOwner(session);

    if (action === 'note') await applyUserAction(env, userId, 'note', String(form.get('note') ?? ''));
    if (action === 'tag') await applyUserAction(env, userId, 'tag_add', String(form.get('tag') ?? ''));
    if (action === 'untag') await applyUserAction(env, userId, 'tag_remove', String(form.get('tag') ?? ''));
    if (action === 'user_delete') await removeUserConversation(env, userId);
    if (action.startsWith('user:')) await applyUserAction(env, userId, action.slice(5) as UserAction, String(form.get('value') ?? ''));
    if (action === 'quick') await saveQuick(env, String(form.get('key') ?? ''), String(form.get('text') ?? ''));
    if (action === 'quick_delete') await removeQuick(env, String(form.get('key') ?? ''));
    if (action === 'keyword') await saveKeyword(env, String(form.get('keyword') ?? ''), String(form.get('reply') ?? ''));
    if (action === 'keyword_delete') await removeKeyword(env, String(form.get('keyword') ?? ''));
    if (action === 'keyword_toggle') await toggleKeyword(env, String(form.get('keyword') ?? ''), String(form.get('enabled') ?? '') === '1');
    if (action === 'setup_basic') await runSetupWizard(env, 'basic');
    if (action === 'domain_save') await saveDomainConfig(env, { domain: String(form.get('domain') ?? '') });
    if (action === 'webhook_setup') {
      const url = await setupTelegramWebhook(env);
      await writeAuditLog(env, { ...audit, detail: `webhook=${url}` });
      const referer = request.headers.get('referer') || `${new URL(request.url).origin}/admin?page=domain`;
      return Response.redirect(addFlash(referer, 'notice', `Telegram Webhook 已设置：${url}`), 303);
    }
    if (action === 'caddy_apply') await applyCaddyConfigNode(env, { publicUrl: String(form.get('public_url') ?? ''), confirm: String(form.get('confirm_value') ?? '') });
    if (action === 'kb_import' && env.KB_ENABLED === 'true') await importTelegramJsonKnowledge(env, String(form.get('json') ?? ''), String(form.get('title') ?? ''));
    if (action === 'kb_entry' && env.KB_ENABLED === 'true') await saveKnowledgeEntry(env, { id: String(form.get('id') ?? '') || undefined, title: String(form.get('title') ?? ''), content: String(form.get('content') ?? ''), tags: String(form.get('tags') ?? ''), source: String(form.get('source') ?? ''), enabled: String(form.get('enabled') ?? '') === '1' });
    if (action === 'kb_delete' && env.KB_ENABLED === 'true') await removeKnowledgeEntry(env, String(form.get('id') ?? ''));
    if (action === 'setting') {
      const key = String(form.get('key') ?? '');
      const value = String(form.get('value') ?? '');
      if (key === 'ai_auto_reply' && value === 'true' && String(form.get('confirm_value') ?? '') !== 'ENABLE_AI_AUTO') throw new Error('开启全局 AI 自动回复需要在确认框输入 ENABLE_AI_AUTO');
      await updateSetting(env, key, value);
    }
    if (action === 'ai_provider') await saveAiProvider(env, { id: String(form.get('id') ?? ''), name: String(form.get('name') ?? ''), base_url: String(form.get('base_url') ?? ''), api_key: String(form.get('api_key') ?? ''), enabled: String(form.get('enabled') ?? '') === '1' ? 1 : 0 });
    if (action === 'ai_provider_delete') await removeAiProvider(env, String(form.get('id') ?? ''));
    if (action === 'ai_provider_import_model') await addModelFromProvider(env, String(form.get('provider_id') ?? ''), String(form.get('model') ?? ''), String(form.get('name') ?? ''), String(form.get('is_default') ?? '') === '1');
    if (action === 'ai_model') await saveAiModel(env, { id: String(form.get('id') ?? ''), name: String(form.get('name') ?? ''), base_url: String(form.get('base_url') ?? ''), model: String(form.get('model') ?? ''), api_key_env: String(form.get('api_key_env') ?? 'AI_API_KEY'), system_prompt: String(form.get('system_prompt') ?? ''), enabled: String(form.get('enabled') ?? '') === '1' ? 1 : 0, is_default: String(form.get('is_default') ?? '') === '1' ? 1 : 0 });
    if (action === 'ai_model_delete') await removeAiModel(env, String(form.get('id') ?? ''));
    if (action === 'ai_model_default') await useAiModel(env, String(form.get('id') ?? ''));
    if (action === 'admin_add') await saveAdmin(env, String(form.get('admin_id') ?? ''), String(form.get('name') ?? ''), String(form.get('role') ?? 'admin'));
    if (action === 'admin_delete') await removeAdminUser(env, String(form.get('admin_id') ?? ''));
    if (action === 'bot_save') await saveBot(env, { id: String(form.get('id') ?? ''), name: String(form.get('name') ?? ''), token: String(form.get('token') ?? ''), webhookSecret: String(form.get('webhook_secret') ?? ''), publicUrl: String(form.get('public_url') ?? ''), supportChatId: String(form.get('support_chat_id') ?? ''), enabled: String(form.get('enabled') ?? '') === '1', isDefault: String(form.get('is_default') ?? '') === '1' });
    if (action === 'bot_delete') await removeBot(env, String(form.get('id') ?? ''));
    if (action === 'sensitive') await addSensitive(env, String(form.get('word') ?? ''));
    if (action === 'sensitive_delete') await removeSensitive(env, String(form.get('word') ?? ''));
    if (action === 'ai_draft') {
      const draft = await draftAiReplyForUser(env, userId, String(form.get('prompt') ?? ''));
      return htmlPage(await renderUserDetail(env, userId, draft));
    }
    if (action === 'direct_reply') await sendDirectReply(env, userId, String(form.get('text') ?? ''));
    if (action === 'direct_quick') await sendQuickReplyToUser(env, userId, String(form.get('quick_key') ?? ''));
    if (action === 'broadcast_draft') await createBroadcastDraft(env, String(form.get('text') ?? ''), 'web-admin', broadcastFilterFromInput(String(form.get('filter') ?? 'all'), String(form.get('filter_value') ?? '')));
    if (action === 'broadcast_confirm') await sendBroadcastDraft(env, String(form.get('id') ?? ''));
    await writeAuditLog(env, audit);
  } catch (err) {
    console.error('admin post failed', err);
    const message = err instanceof Error ? err.message : String(err);
    await writeAuditLog(env, { ...audit, status: 'failed', detail: message });
    const referer = request.headers.get('referer');
    const fallback = `${new URL(request.url).origin}/admin`;
    return Response.redirect(addFlash(referer || fallback, 'error', message), 303);
  }

  const referer = request.headers.get('referer');
  const fallback = `${new URL(request.url).origin}/admin`;
  return Response.redirect(addFlash(referer || fallback, 'notice', '操作已完成'), 303);
}

async function applyCaddyConfigNode(env: Env, input: { publicUrl?: string; confirm?: string }): Promise<unknown> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<typeof import('./services/caddy')>;
  const mod = await dynamicImport('./services/caddy');
  return mod.applyCaddyConfig(env, input);
}

function auditContext(request: Request, action: string, target?: string) {
  return {
    actor: request.headers.get('x-admin-user-id') || 'web-admin',
    ip: loginClientId(request),
    action,
    target,
    detail: { path: new URL(request.url).pathname },
  };
}
