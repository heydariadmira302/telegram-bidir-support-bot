import {
  getBroadcast,
  listBroadcastResults,
  listBroadcasts,
  listBroadcastTargets,
  markBroadcastSent,
  saveBroadcast,
  saveBroadcastResult,
} from '../db';
import { sendMessage } from '../telegram';
import type { BroadcastTargetFilter, Env } from '../types';

export async function getBroadcastPanel(env: Env, filter?: BroadcastTargetFilter) {
  const normalized = serializeBroadcastFilter(filter ?? { type: 'all' });
  const [broadcasts, targets] = await Promise.all([listBroadcasts(env.DB, 30, env), listBroadcastTargets(env.DB, 1000, normalized, env)]);
  return { broadcasts, targetCount: targets.length, filter: normalized };
}

export async function getBroadcastDetail(env: Env, id: string) {
  id = id.trim();
  if (!id) throw new Error('broadcast id is required');
  const [broadcast, results] = await Promise.all([getBroadcast(env.DB, id, env), listBroadcastResults(env.DB, id, 500, env)]);
  return { broadcast, results };
}

export async function createBroadcastDraft(env: Env, text: string, createdBy?: string, filter?: BroadcastTargetFilter): Promise<{ id: string; targetCount: number; filter: string }> {
  text = text.trim();
  if (!text) throw new Error('broadcast text is required');
  const normalized = serializeBroadcastFilter(filter ?? { type: 'all' });
  const targets = await listBroadcastTargets(env.DB, 1000, normalized, env);
  const id = crypto.randomUUID().slice(0, 8);
  await saveBroadcast(env.DB, id, text, createdBy, normalized, targets.length, env);
  return { id, targetCount: targets.length, filter: normalized };
}

export async function sendBroadcastDraft(env: Env, id: string): Promise<{ ok: number; failed: number; targetCount: number }> {
  id = id.trim();
  if (!id) throw new Error('broadcast id is required');
  const draft = await getBroadcast(env.DB, id, env);
  if (!draft || draft.status !== 'draft') throw new Error('broadcast draft not found or already sent');

  const targets = await listBroadcastTargets(env.DB, 1000, draft.target_filter ?? 'all', env);
  let ok = 0;
  let failed = 0;
  for (const user of targets) {
    try {
      await sendMessage(env, user.user_chat_id, draft.text);
      await saveBroadcastResult(env.DB, id, user.user_chat_id, 'ok', undefined, env);
      ok += 1;
      await sleep(40);
    } catch (err) {
      await saveBroadcastResult(env.DB, id, user.user_chat_id, 'failed', err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500), env);
      failed += 1;
    }
  }
  await markBroadcastSent(env.DB, id, ok, failed, targets.length, env);
  return { ok, failed, targetCount: targets.length };
}

export function serializeBroadcastFilter(filter: BroadcastTargetFilter): string {
  if (filter.type === 'tag') {
    const value = filter.value?.trim();
    if (!value) throw new Error('tag filter value is required');
    return `tag:${value}`;
  }
  if (filter.type === 'active_days') {
    const days = Math.max(1, Math.min(365, Number(filter.value) || 7));
    return `active_days:${days}`;
  }
  if (filter.type === 'pending' || filter.type === 'important' || filter.type === 'all') return filter.type;
  throw new Error('unsupported broadcast filter');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
