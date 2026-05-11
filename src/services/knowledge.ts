import { createKbImportBatch, deleteKbEntry, insertKbRawMessage, listKbEntries, listKbRawMessages, upsertKbEntry } from '../db';
import type { Env } from '../types';

export async function getKnowledgePanel(env: Env, q?: string) {
  const [raw, entries] = await Promise.all([listKbRawMessages(env.DB, q, 100), listKbEntries(env.DB, q, 100)]);
  return { raw, entries };
}

export async function importTelegramJsonKnowledge(env: Env, jsonText: string, title?: string): Promise<{ batchId: string; count: number }> {
  const parsed = JSON.parse(jsonText) as { name?: string; messages?: Array<{ id?: number | string; type?: string; date?: string; from?: string; text?: unknown }> };
  const messages = parsed.messages ?? [];
  const batchId = crypto.randomUUID().slice(0, 12);
  let count = 0;
  for (const msg of messages) {
    const text = normalizeTelegramText(msg.text);
    if (!text || text.length < 2) continue;
    await insertKbRawMessage(env.DB, {
      batch_id: batchId,
      source: 'telegram-json',
      chat_title: parsed.name ?? title ?? null,
      message_id: msg.id == null ? null : String(msg.id),
      sender_name: msg.from ?? null,
      message_date: msg.date ?? null,
      text,
      tags: null,
    });
    count += 1;
  }
  await createKbImportBatch(env.DB, batchId, 'telegram-json', title ?? parsed.name ?? null, count);
  return { batchId, count };
}

export async function saveKnowledgeEntry(env: Env, input: { id?: string; title: string; content: string; tags?: string; source?: string; enabled?: boolean }): Promise<string> {
  const id = input.id?.trim() || crypto.randomUUID().slice(0, 12);
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || !content) throw new Error('knowledge title and content are required');
  await upsertKbEntry(env.DB, { id, title, content, tags: input.tags?.trim() || null, source: input.source?.trim() || null, confidence: 'manual', enabled: input.enabled === false ? 0 : 1 });
  return id;
}

export async function removeKnowledgeEntry(env: Env, id: string): Promise<void> {
  id = id.trim();
  if (!id) throw new Error('knowledge id is required');
  await deleteKbEntry(env.DB, id);
}

function normalizeTelegramText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((x) => typeof x === 'string' ? x : typeof x === 'object' && x && 'text' in x ? String((x as { text?: unknown }).text ?? '') : '').join('').trim();
  return '';
}
