import type { Env } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function encryptSecret(env: Env, plain: string): Promise<string> {
  const secret = env.ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) throw new Error('ENCRYPTION_SECRET is required to store API keys');
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plain)));
  return `v1.${base64Url(iv)}.${base64Url(encrypted)}`;
}

export async function decryptSecret(env: Env, encrypted: string): Promise<string> {
  const secret = env.ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) throw new Error('ENCRYPTION_SECRET is required to use stored API keys');
  const [version, ivRaw, dataRaw] = encrypted.split('.');
  if (version !== 'v1' || !ivRaw || !dataRaw) throw new Error('invalid encrypted secret format');
  const key = await deriveKey(secret);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(ivRaw) }, key, fromBase64Url(dataRaw));
  return decoder.decode(plain);
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function base64Url(bytes: Uint8Array): string {
  const raw = String.fromCharCode(...bytes);
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
