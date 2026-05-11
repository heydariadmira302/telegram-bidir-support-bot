import { deleteWorkspaceAdmin, getWorkspace, listBots, listWorkspaceAdmins, listWorkspaces, upsertWorkspace, upsertWorkspaceAdmin } from '../db';
import { isAdminRole } from '../admin-permissions';
import { DEFAULT_WORKSPACE_ID } from '../tenant';
import type { AdminRole, Env } from '../types';

export async function getWorkspaceApiPanel(env: Env) {
  const workspaceId = env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID;
  const [workspaces, current, bots, admins] = await Promise.all([
    listWorkspaces(env.DB),
    getWorkspace(env.DB, workspaceId),
    listBots(env.DB, workspaceId),
    listWorkspaceAdmins(env.DB, workspaceId),
  ]);
  return { workspaces, current, bots, admins };
}

export async function saveWorkspace(env: Env, input: { id: string; name: string }): Promise<void> {
  const id = normalizeWorkspaceId(input.id);
  const name = input.name.trim();
  if (!name) throw new Error('Workspace 名称不能为空');
  await upsertWorkspace(env.DB, { id, name });
}

export async function saveWorkspaceAdmin(env: Env, input: { workspaceId?: string; userId: string; name?: string; role: AdminRole | string }): Promise<void> {
  const workspaceId = normalizeWorkspaceId(input.workspaceId || env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID);
  const userId = input.userId.trim();
  if (!/^\d+$/.test(userId)) throw new Error('管理员 Telegram user id 必须是数字');
  if (!isAdminRole(String(input.role))) throw new Error('unsupported admin role');
  await upsertWorkspaceAdmin(env.DB, { workspace_id: workspaceId, user_id: userId, name: input.name?.trim() || null, role: input.role as AdminRole });
}

export async function removeWorkspaceAdmin(env: Env, workspaceId: string | undefined, userId: string): Promise<void> {
  workspaceId = normalizeWorkspaceId(workspaceId || env.WORKSPACE_ID || DEFAULT_WORKSPACE_ID);
  userId = userId.trim();
  if (!/^\d+$/.test(userId)) throw new Error('管理员 Telegram user id 必须是数字');
  await deleteWorkspaceAdmin(env.DB, workspaceId, userId);
}

function normalizeWorkspaceId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,48}$/.test(id)) throw new Error('Workspace ID 只能用小写字母、数字、下划线、短横线，长度 2-49');
  return id;
}
