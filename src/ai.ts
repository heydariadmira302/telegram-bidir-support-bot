import { findKnowledgeEntries, getAiProvider, getDefaultAiModel, getRecentLogs, getSetting, getUserByChatId } from './db';
import { decryptSecret } from './crypto';
import type { Env } from './types';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export async function isAiEnabled(env: Env): Promise<boolean> {
  const hasApiKey = Boolean(env.AI_API_KEY || await hasStoredAiProviderKey(env));
  if (!hasApiKey) return false;
  const configured = env.AI_AUTO_REPLY ?? (await getSetting(env.DB, 'ai_enabled', env)) ?? 'false';
  return configured === 'true';
}

export async function isAiAutoReplyEnabled(env: Env): Promise<boolean> {
  const hasApiKey = Boolean(env.AI_API_KEY || await hasStoredAiProviderKey(env));
  if (!hasApiKey) return false;
  const configured = env.AI_AUTO_REPLY ?? (await getSetting(env.DB, 'ai_auto_reply', env)) ?? 'false';
  return configured === 'true';
}

export async function draftReply(env: Env, userChatId: string, latestText?: string): Promise<string> {
  const selected = await getDefaultAiModel(env.DB);
  const provider = selected?.provider_id ? await getAiProvider(env.DB, selected.provider_id) : null;
  const apiKeyEnv = selected?.api_key_env || provider?.api_key_hint || 'AI_API_KEY';
  const apiKey = provider?.api_key_encrypted ? await decryptSecret(env, provider.api_key_encrypted) : getEnvValue(env, apiKeyEnv);
  if (!apiKey) throw new Error(`${apiKeyEnv} is not configured`);

  const user = await getUserByChatId(env.DB, userChatId, env);
  const logs = await getRecentLogs(env.DB, userChatId, 10, env);
  const knowledge = latestText && env.KB_ENABLED === 'true' ? await findKnowledgeEntries(env.DB, latestText, 5) : [];
  const baseUrl = (env.AI_BASE_URL ?? provider?.base_url ?? selected?.base_url ?? (await getSetting(env.DB, 'ai_base_url', env)) ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = env.AI_MODEL ?? selected?.model ?? (await getSetting(env.DB, 'ai_model', env)) ?? 'gpt-4o-mini';
  const system =
    env.AI_SYSTEM_PROMPT ??
    selected?.system_prompt ??
    (await getSetting(env.DB, 'ai_system_prompt', env)) ??
    '你是一个 Telegram 客服助手。请用简洁、礼貌、自然的中文帮助管理员起草回复。';

  const context = [
    `用户ID：${userChatId}`,
    user?.username ? `用户名：@${user.username}` : '',
    user?.note ? `备注：${user.note}` : '',
    user?.tags ? `标签：${user.tags}` : '',
    latestText ? `用户最新消息：${latestText}` : '',
    '',
    knowledge.length ? '可参考的已启用知识库：' : '',
    ...knowledge.map((x, i) => `【知识${i + 1}】${x.title}\n${x.content}`),
    knowledge.length ? '如果知识库没有明确答案，请提醒需要人工确认，不要编造。' : '',
    '',
    '最近聊天记录：',
    ...logs.map((x) => `${x.direction === 'in' ? '用户' : '客服'}：${x.text}`),
  ]
    .filter(Boolean)
    .join('\n');

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: context },
      ],
      temperature: 0.4,
    }),
  });

  const data = (await res.json()) as ChatCompletionResponse;
  if (!res.ok) throw new Error(data.error?.message ?? `AI request failed: ${res.status}`);
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('AI returned empty response');
  return content;
}


async function hasStoredAiProviderKey(env: Env): Promise<boolean> {
  const selected = await getDefaultAiModel(env.DB);
  const provider = selected?.provider_id ? await getAiProvider(env.DB, selected.provider_id) : null;
  return Boolean(provider?.api_key_encrypted);
}

function getEnvValue(env: Env, key: string): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[key];
}
