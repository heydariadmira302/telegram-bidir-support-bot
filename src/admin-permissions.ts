import { getDbAdmin } from './db';
import { getSessionActor } from './admin-auth';
import type { AdminRole, AdminSession, Env } from './types';

export function parseOwnerIds(value?: string): Set<string> {
  return new Set((value ?? '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean));
}

export async function getAdminSession(request: Request, env: Env): Promise<AdminSession> {
  const actor = request.headers.get('x-admin-user-id') || await getSessionActor(request, env) || 'web-admin';
  const ownerIds = parseOwnerIds(env.OWNER_IDS);
  const isOwner = actor !== 'web-admin' && ownerIds.has(actor);
  if (isOwner) return buildSession('owner', actor, true);

  if (actor !== 'web-admin') {
    const row = await getDbAdmin(env.DB, actor);
    if (row) return buildSession(normalizeRole(row.role), actor, false);
  }

  // Password-authenticated web sessions do not identify a Telegram user, so keep
  // them fully capable for backwards-compatible single-admin deployments.
  return buildSession('owner', actor, true);
}

export function assertCanWrite(session: AdminSession): void {
  if (!session.canWrite) throw new Error('readonly admin cannot perform write operations');
}

export function assertOwner(session: AdminSession): void {
  if (session.role !== 'owner') throw new Error('owner permission required');
}

export function canAccessAudit(session: AdminSession): boolean {
  return session.role === 'owner';
}

export function canManageAdmins(session: AdminSession): boolean {
  return session.role === 'owner';
}

export function canManageAiProviders(session: AdminSession): boolean {
  return session.role === 'owner';
}

export function isAdminRole(value: string): value is AdminRole {
  return value === 'owner' || value === 'admin' || value === 'readonly';
}

function normalizeRole(value: string): AdminRole {
  return isAdminRole(value) ? value : 'admin';
}

function buildSession(role: AdminRole, actor: string, isOwner: boolean): AdminSession {
  return { role, actor, isOwner, canWrite: role === 'owner' || role === 'admin' };
}
