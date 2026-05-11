import type { Env } from './types';

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const CSRF_COOKIE = 'admin_csrf';
const LOGIN_CHALLENGE_COOKIE = 'admin_login_challenge';
const LOGIN_LIMIT_MAX = 5;
const LOGIN_LIMIT_WINDOW_SECONDS = 10 * 60;

export function getTelegramLoginStatus(env: Env): { enabled: boolean; reason: string } {
  if (!env.BOT_TOKEN) return { enabled: false, reason: '未配置 BOT_TOKEN，无法发送 Telegram 验证码。' };
  if (!env.OWNER_IDS?.trim()) return { enabled: false, reason: '未配置 OWNER_IDS，无法确定验证码接收账号。' };
  if (!env.KV) return { enabled: false, reason: 'KV 没有绑定，变量名必须是 KV；后台验证码需要 KV 保存 5 分钟挑战。' };
  return { enabled: true, reason: '' };
}

export function isTelegramLoginEnabled(env: Env): boolean {
  return getTelegramLoginStatus(env).enabled;
}

export async function isAuthed(request: Request, env: Env): Promise<boolean> {
  const auth = request.headers.get('authorization');
  const wantsBrowserPage = request.headers.get('accept')?.includes('text/html') && new URL(request.url).pathname.startsWith('/admin');
  if (!wantsBrowserPage && env.ADMIN_PASSWORD && auth?.startsWith('Bearer ') && auth.slice(7) === env.ADMIN_PASSWORD) return true;
  const cookies = parseCookies(request.headers.get('cookie') ?? '');
  const session = cookies[SESSION_COOKIE];
  return Boolean(session && await verifySession(session, env));
}

export async function getSessionActor(request: Request, env: Env): Promise<string | null> {
  const session = parseCookies(request.headers.get('cookie') ?? '')[SESSION_COOKIE];
  if (!session || !(await verifySession(session, env))) return null;
  const [payload] = session.split('.');
  const [, actor] = decodeSessionPayload(payload ?? '').split(':');
  return actor || 'web-admin';
}

export async function createSessionCookie(env: Env, actor = 'web-admin', secure = true): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = encodeSessionPayload(`${expiresAt}:${actor}`);
  const sig = await hmac(payload, sessionSecret(env));
  return `${SESSION_COOKIE}=${payload}.${sig}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function createLoginChallengeCookie(challengeId: string, secure = true): string {
  return `${LOGIN_CHALLENGE_COOKIE}=${challengeId}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Path=/admin; Max-Age=300`;
}

export function clearLoginChallengeCookie(secure = true): string {
  return `${LOGIN_CHALLENGE_COOKIE}=; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Path=/admin; Max-Age=0`;
}

export function clearSessionCookie(secure = true): string {
  return `${SESSION_COOKIE}=; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=0`;
}

export function clearCsrfCookie(secure = true): string {
  return `${CSRF_COOKIE}=; ${secure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=0`;
}

export function getLoginChallengeId(request: Request): string | null {
  return parseCookies(request.headers.get('cookie') ?? '')[LOGIN_CHALLENGE_COOKIE] ?? null;
}

export async function createLoginChallenge(env: Env, adminId: string, clientId: string): Promise<{ challengeId: string; code: string }> {
  if (!env.KV) throw new Error('KV is required for Telegram login challenge');
  const challengeId = crypto.randomUUID();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await hmac(`${challengeId}:${adminId}:${code}:${clientId}`, sessionSecret(env));
  await env.KV.put(`admin-login-challenge:${challengeId}`, JSON.stringify({ adminId, codeHash, clientId }), { expirationTtl: 300 });
  return { challengeId, code };
}

export async function verifyLoginChallenge(env: Env, challengeId: string, code: string, clientId: string): Promise<string | null> {
  if (!env.KV) return null;
  const raw = await env.KV.get(`admin-login-challenge:${challengeId}`);
  if (!raw) return null;
  const data = JSON.parse(raw) as { adminId?: string; codeHash?: string; clientId?: string };
  if (!data.adminId || !data.codeHash || data.clientId !== clientId) return null;
  const expected = await hmac(`${challengeId}:${data.adminId}:${code.trim()}:${clientId}`, sessionSecret(env));
  if (!timingSafeEqual(expected, data.codeHash)) return null;
  await env.KV.delete(`admin-login-challenge:${challengeId}`);
  return data.adminId;
}

export function newCsrfCookie(secure = true): string {
  const token = crypto.randomUUID();
  return `${CSRF_COOKIE}=${token}; ${secure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function csrfInput(): string {
  return `<input type="hidden" name="csrf" value="" data-csrf />`;
}

export function validCsrf(request: Request, form?: FormData): boolean {
  const cookies = parseCookies(request.headers.get('cookie') ?? '');
  const csrf = cookies[CSRF_COOKIE];
  if (!csrf) return false;
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return timingSafeEqual(request.headers.get('x-csrf-token') ?? '', csrf);
  return timingSafeEqual(String(form?.get('csrf') ?? ''), csrf);
}

export async function isLoginLimited(env: Env, clientId: string): Promise<boolean> {
  if (!env.KV) return false;
  const key = `admin-login:${clientId}`;
  return Number((await env.KV.get(key)) ?? 0) >= LOGIN_LIMIT_MAX;
}

export async function recordLoginFailure(env: Env, clientId: string): Promise<void> {
  if (!env.KV) return;
  const key = `admin-login:${clientId}`;
  const next = Number((await env.KV.get(key)) ?? 0) + 1;
  await env.KV.put(key, String(next), { expirationTtl: LOGIN_LIMIT_WINDOW_SECONDS });
}

export async function clearLoginFailures(env: Env, clientId: string): Promise<void> {
  if (env.KV) await env.KV.delete(`admin-login:${clientId}`);
}

export function loginClientId(request: Request): string {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

export function redirectWithSession(location: string, sessionCookie: string, csrfCookie: string): Response {
  return new Response(null, { status: 303, headers: [['location', location], ['set-cookie', sessionCookie], ['set-cookie', csrfCookie], ['cache-control', 'no-store']] });
}

export function shouldUseSecureCookies(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '');
  return proto === 'https';
}

async function verifySession(session: string, env: Env): Promise<boolean> {
  const [payload, sig] = session.split('.');
  const decoded = decodeSessionPayload(payload ?? '');
  const [expiresAt] = decoded.split(':');
  if (!payload || !expiresAt || !sig || Number(expiresAt) < Math.floor(Date.now() / 1000)) return false;
  return timingSafeEqual(sig, await hmac(payload, sessionSecret(env)));
}

function encodeSessionPayload(value: string): string {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeSessionPayload(value: string): string {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  try { return atob(padded); } catch { return ''; }
}

function sessionSecret(env: Env): string {
  const secret = env.ADMIN_PASSWORD || env.ENCRYPTION_SECRET || env.WEBHOOK_SECRET;
  if (!secret) throw new Error('Session secret is not configured');
  return secret;
}

async function hmac(value: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(header.split(';').map((part) => {
    const [name, ...rest] = part.trim().split('=');
    return [name, rest.join('=')];
  }).filter(([name]) => name));
}
