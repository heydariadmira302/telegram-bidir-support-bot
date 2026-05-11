#!/usr/bin/env node
const base = process.argv[2] || 'http://127.0.0.1:3000';
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeCookies(headers) {
  const cookies = headers.getSetCookie ? headers.getSetCookie() : [];
  for (const raw of cookies) {
    const [pair] = raw.split(';');
    const [name, ...rest] = pair.split('=');
    if (!name) continue;
    const value = rest.join('=');
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
}

async function req(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (jar.size) headers.set('cookie', cookieHeader());
  const res = await fetch(`${base}${path}`, { ...options, headers, redirect: 'manual' });
  storeCookies(res.headers);
  return res;
}

const login = await req('/admin/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
console.log('login', login.status, login.headers.get('location'), [...jar.keys()].join(','));
if (login.status !== 303 || login.headers.get('location') !== '/admin/verify' || !jar.has('admin_login_challenge')) process.exit(1);

const verify = await req('/admin/verify');
const text = await verify.text();
console.log('verify', verify.status, /Telegram 验证/.test(text));
if (verify.status !== 200 || !/Telegram 验证/.test(text)) process.exit(1);

const bad = await req('/admin/verify', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'code=000000' });
console.log('bad-code', bad.status, jar.has('admin_login_challenge'));
if (bad.status !== 401 || !jar.has('admin_login_challenge')) process.exit(1);
