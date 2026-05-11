import {
  addSensitiveWord,
  deleteKeywordReply,
  deleteQuickReply,
  deleteSensitiveWord,
  getQuickReply,
  logMessage,
  setKeywordEnabled,
  setKeywordReply,
  setQuickReply,
  setUserPending,
} from '../db';
import { draftReply } from '../ai';
import { sendMessage } from '../telegram';
import type { Env } from '../types';

export async function saveQuick(env: Env, key: string, text: string): Promise<void> {
  key = key.trim();
  text = text.trim();
  if (!key || !text) throw new Error('quick reply key and text are required');
  await setQuickReply(env.DB, key, text, env);
}

export async function removeQuick(env: Env, key: string): Promise<void> {
  key = key.trim();
  if (!key) throw new Error('quick reply key is required');
  await deleteQuickReply(env.DB, key, env);
}

export async function saveKeyword(env: Env, keyword: string, reply: string): Promise<void> {
  keyword = keyword.trim();
  reply = reply.trim();
  if (!keyword || !reply) throw new Error('keyword and reply are required');
  await setKeywordReply(env.DB, keyword, reply, env);
}

export async function removeKeyword(env: Env, keyword: string): Promise<void> {
  keyword = keyword.trim();
  if (!keyword) throw new Error('keyword is required');
  await deleteKeywordReply(env.DB, keyword, env);
}

export async function toggleKeyword(env: Env, keyword: string, enabled: boolean): Promise<void> {
  keyword = keyword.trim();
  if (!keyword) throw new Error('keyword is required');
  await setKeywordEnabled(env.DB, keyword, enabled, env);
}

export async function addSensitive(env: Env, word: string): Promise<void> {
  const words = word.split(/[\n,，]/).map((x) => x.trim()).filter(Boolean);
  if (!words.length) throw new Error('word is required');
  for (const item of words) await addSensitiveWord(env.DB, item, env);
}

export async function removeSensitive(env: Env, word: string): Promise<void> {
  word = word.trim();
  if (!word) throw new Error('word is required');
  await deleteSensitiveWord(env.DB, word, env);
}

export async function sendDirectReply(env: Env, userId: string, text: string, messageId = 0): Promise<void> {
  userId = userId.trim();
  text = text.trim();
  if (!userId || !text) throw new Error('user_id and text are required');
  await sendMessage(env, userId, text);
  await logMessage(env.DB, userId, 'out', messageId, text, env);
  await setUserPending(env.DB, userId, false, env);
}

export async function draftAiReplyForUser(env: Env, userId: string, prompt?: string): Promise<string> {
  userId = userId.trim();
  if (!userId) throw new Error('user_id is required');
  return draftReply(env, userId, prompt?.trim() || undefined);
}

export async function sendQuickReplyToUser(env: Env, userId: string, key: string, messageId = 0): Promise<string> {
  userId = userId.trim();
  key = key.trim();
  if (!userId || !key) throw new Error('user_id and quick reply key are required');
  const quick = await getQuickReply(env.DB, key, env);
  if (!quick) throw new Error('quick reply not found');
  await sendDirectReply(env, userId, quick.text, messageId);
  return quick.text;
}
