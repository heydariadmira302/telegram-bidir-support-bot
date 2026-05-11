import { addAuditLog, listAuditLogs } from '../db';
import type { Env } from '../types';

export async function writeAuditLog(env: Env, input: { actor?: string | null; ip?: string | null; action: string; target?: string | null; detail?: unknown; status?: string }): Promise<void> {
  await addAuditLog(env.DB, {
    actor: input.actor ?? null,
    ip: input.ip ?? null,
    action: input.action,
    target: input.target ?? null,
    detail: input.detail == null ? null : safeJson(input.detail),
    status: input.status ?? 'ok',
  });
}

export async function getAuditPanel(env: Env) {
  return { logs: await listAuditLogs(env.DB, 200) };
}

function safeJson(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/bot\d+:[\w-]+/gi, '[REDACTED_BOT_TOKEN]').replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_API_KEY]').slice(0, 1000);
}
