import { getWorkbenchStatsRow, listPendingUsers, listUsers } from '../db';
import type { Env, UserRow } from '../types';

export type SupportQueueKind = 'pending' | 'important' | 'overdue' | 'recent';

export interface SupportWorkbenchSummary {
  pending: number;
  important: number;
  overdue: number;
  recent: number;
}

export interface WorkbenchStats {
  todayUsers: number;
  todayNewUsers: number;
  todayInboundMessages: number;
  todayOutboundMessages: number;
  waitingUsers: number;
  longestWaitingSeconds: number;
  weekUsers: number;
  weekMessages: number;
  weekNewUsers: number;
  blockedUsers: number;
}

export interface SupportQueuePanel {
  kind: SupportQueueKind;
  summary: SupportWorkbenchSummary;
  users: UserRow[];
}

const OVERDUE_MINUTES = 30;

export async function getSupportWorkbench(env: Env): Promise<SupportWorkbenchSummary> {
  const [pending, recent] = await Promise.all([
    listPendingUsers(env.DB, 200, env),
    listUsers(env.DB, undefined, 200, env),
  ]);
  return {
    pending: pending.length,
    important: recent.filter((row) => Boolean(row.important) && !row.is_blocked).length,
    overdue: pending.filter(isOverdue).length,
    recent: recent.length,
  };
}

export async function getWorkbenchStats(env: Env): Promise<WorkbenchStats> {
  const [stats, pending, recent] = await Promise.all([
    getWorkbenchStatsRow(env.DB, env),
    listPendingUsers(env.DB, 500, env),
    listUsers(env.DB, undefined, 500, env),
  ]);
  const waiting = pending.filter((row) => !row.is_blocked);
  return {
    todayUsers: Number(stats.today_users || 0),
    todayNewUsers: Number(stats.today_new_users || 0),
    todayInboundMessages: Number(stats.today_inbound_messages || 0),
    todayOutboundMessages: Number(stats.today_outbound_messages || 0),
    waitingUsers: waiting.length,
    longestWaitingSeconds: longestWaitingSeconds(waiting),
    weekUsers: Number(stats.week_users || 0),
    weekMessages: Number(stats.week_messages || 0),
    weekNewUsers: Number(stats.week_new_users || 0),
    blockedUsers: recent.filter((row) => Boolean(row.is_blocked)).length,
  };
}

export async function getSupportQueue(env: Env, kind: SupportQueueKind, limit = 10): Promise<SupportQueuePanel> {
  const [summary, pending, recent] = await Promise.all([
    getSupportWorkbench(env),
    listPendingUsers(env.DB, 200, env),
    listUsers(env.DB, undefined, 200, env),
  ]);

  const source = kind === 'pending'
    ? pending
    : kind === 'important'
      ? recent.filter((row) => Boolean(row.important) && !row.is_blocked)
      : kind === 'overdue'
        ? pending.filter(isOverdue)
        : recent;

  return { kind, summary, users: source.slice(0, limit) };
}

export function topicUrl(env: Env, row: UserRow): string | null {
  if (!env.SUPPORT_CHAT_ID || !row.topic_id) return null;
  const internalChatId = String(env.SUPPORT_CHAT_ID).replace(/^-100/, '');
  if (!internalChatId) return null;
  return `https://t.me/c/${internalChatId}/${row.topic_id}`;
}

function longestWaitingSeconds(rows: UserRow[]): number {
  const now = Date.now();
  return rows.reduce((max, row) => {
    const ts = row.last_message_at ? Date.parse(`${row.last_message_at.replace(' ', 'T')}Z`) : NaN;
    if (!Number.isFinite(ts)) return max;
    return Math.max(max, Math.max(0, Math.floor((now - ts) / 1000)));
  }, 0);
}

function isOverdue(row: UserRow): boolean {
  const ts = row.last_message_at ? Date.parse(`${row.last_message_at.replace(' ', 'T')}Z`) : NaN;
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts >= OVERDUE_MINUTES * 60 * 1000;
}
