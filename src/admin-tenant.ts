import { getBotById, getWorkspaceAdmin } from './db';
import { DEFAULT_BOT_ID, DEFAULT_WORKSPACE_ID, ensureDefaultBot, hydrateBotConfig, withTenant } from './tenant';
import type { AdminSession, BotRow, Env } from './types';

export interface AdminTenantResolution {
  env: Env;
  bot: BotRow;
  requestedWorkspaceId: string;
  requestedBotId: string;
}

export async function resolveAdminTenant(env: Env, input?: { workspaceId?: string | null; botId?: string | null; session?: AdminSession | null }): Promise<AdminTenantResolution> {
  await ensureDefaultBot(env);
  const workspaceId = normalizeRequestedWorkspaceId(input?.workspaceId);
  const botId = normalizeRequestedBotId(input?.botId);
  await assertWorkspaceAccess(env, workspaceId, input?.session ?? null);
  const row = await getBotById(env.DB, botId, workspaceId);
  if (!row) throw new Error(`Bot 不存在：${workspaceId}/${botId}`);
  if (row.enabled !== 1) throw new Error(`Bot 已停用：${workspaceId}/${botId}`);
  const bot = await hydrateBotConfig(env, row);
  return {
    env: withTenant(env, { workspaceId: bot.workspace_id || workspaceId, botId: bot.id, bot }),
    bot: row,
    requestedWorkspaceId: workspaceId,
    requestedBotId: botId,
  };
}

export async function assertWorkspaceAccess(env: Env, workspaceId: string, session?: AdminSession | null): Promise<void> {
  if (!session) return;
  if (session.isOwner || session.actor === 'web-admin') return;
  const membership = await getWorkspaceAdmin(env.DB, workspaceId, session.actor);
  if (!membership) throw new Error(`没有 workspace 权限：${workspaceId}`);
}

export function normalizeRequestedWorkspaceId(value?: string | null): string {
  const id = (value ?? '').trim().toLowerCase();
  return id || DEFAULT_WORKSPACE_ID;
}

export function normalizeRequestedBotId(value?: string | null): string {
  const id = (value ?? '').trim().toLowerCase();
  return id || DEFAULT_BOT_ID;
}
