import { deleteAiModel, deleteAiProvider, getAiModel, getAiProvider, listAiModels, listAiProviders, setAiModelEnabled, setDefaultAiModel, upsertAiModel, upsertAiProvider } from '../db';
import { decryptSecret, encryptSecret, maskSecret } from '../crypto';
import type { AiModelRow, AiProviderRow, Env } from '../types';

export async function getAiConfigPanel(env: Env): Promise<{ providers: AiProviderRow[]; models: AiModelRow[] }> {
  const [providers, models] = await Promise.all([listAiProviders(env.DB), listAiModels(env.DB)]);
  return { providers, models };
}

export async function saveAiProvider(env: Env, input: Partial<AiProviderRow> & { api_key?: string }): Promise<void> {
  const id = String(input.id ?? '').trim();
  const name = String(input.name ?? '').trim() || id;
  const baseUrl = String(input.base_url ?? '').trim().replace(/\/$/, '');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('provider id can only contain letters, numbers, underscore, and dash');
  if (!name || !baseUrl) throw new Error('provider name and base_url are required');
  const apiKey = input.api_key?.trim();
  await upsertAiProvider(env.DB, {
    id,
    name,
    base_url: baseUrl,
    api_key_encrypted: apiKey ? await encryptSecret(env, apiKey) : null,
    api_key_hint: apiKey ? maskSecret(apiKey) : input.api_key_hint ?? null,
    enabled: input.enabled ? 1 : 0,
  });
}

export async function removeAiProvider(env: Env, id: string): Promise<void> {
  id = id.trim();
  if (!id) throw new Error('provider id is required');
  await deleteAiProvider(env.DB, id);
}

export async function fetchProviderModels(env: Env, providerId: string): Promise<string[]> {
  const provider = await getAiProvider(env.DB, providerId.trim());
  if (!provider || !provider.enabled) throw new Error('AI provider not found or disabled');
  if (!provider.api_key_encrypted) throw new Error('provider API key is not configured');
  const apiKey = await decryptSecret(env, provider.api_key_encrypted);
  const res = await fetch(`${provider.base_url.replace(/\/$/, '')}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
  const data = (await res.json()) as { data?: Array<{ id?: string }>; error?: { message?: string } };
  if (!res.ok) throw new Error(sanitizeProviderError(data.error?.message ?? `list models failed: ${res.status}`));
  return (data.data ?? []).map((x) => x.id).filter((x): x is string => Boolean(x)).sort();
}

export async function addModelFromProvider(env: Env, providerId: string, modelId: string, name?: string, isDefault = false): Promise<void> {
  const provider = await getAiProvider(env.DB, providerId.trim());
  if (!provider) throw new Error('AI provider not found');
  await saveAiModel(env, {
    id: `${provider.id}_${modelId}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    provider_id: provider.id,
    name: name?.trim() || modelId,
    base_url: provider.base_url,
    model: modelId,
    api_key_env: 'AI_API_KEY',
    enabled: 1,
    is_default: isDefault ? 1 : 0,
  });
}

export async function saveAiModel(env: Env, input: Partial<AiModelRow>): Promise<void> {
  const id = String(input.id ?? '').trim();
  const name = String(input.name ?? '').trim() || id;
  const baseUrl = String(input.base_url ?? '').trim().replace(/\/$/, '');
  const model = String(input.model ?? '').trim();
  const apiKeyEnv = String(input.api_key_env ?? 'AI_API_KEY').trim() || 'AI_API_KEY';
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('model id can only contain letters, numbers, underscore, and dash');
  if (!name || !baseUrl || !model) throw new Error('model name, base_url, and model are required');
  if (!/^[A-Z0-9_]+$/.test(apiKeyEnv)) throw new Error('api key env must look like AI_API_KEY');
  await upsertAiModel(env.DB, {
    id,
    provider_id: input.provider_id ?? null,
    name,
    base_url: baseUrl,
    model,
    api_key_env: apiKeyEnv,
    system_prompt: input.system_prompt == null ? null : String(input.system_prompt),
    enabled: input.enabled ? 1 : 0,
    is_default: input.is_default ? 1 : 0,
  });
}

export async function toggleAiModel(env: Env, id: string, enabled: boolean): Promise<void> {
  id = id.trim();
  if (!id) throw new Error('model id is required');
  await setAiModelEnabled(env.DB, id, enabled);
}

export async function removeAiModel(env: Env, id: string): Promise<void> {
  id = id.trim();
  if (!id) throw new Error('model id is required');
  await deleteAiModel(env.DB, id);
}

export async function useAiModel(env: Env, id: string): Promise<void> {
  id = id.trim();
  if (!id) throw new Error('model id is required');
  const row = await getAiModel(env.DB, id);
  if (!row) throw new Error('AI model not found');
  await setDefaultAiModel(env.DB, id);
}

export async function listAiModelConfigs(env: Env): Promise<AiModelRow[]> {
  return listAiModels(env.DB);
}

function sanitizeProviderError(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED_API_KEY]')
    .replace(/(api[_-]?key["'\s:=]+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]');
}
