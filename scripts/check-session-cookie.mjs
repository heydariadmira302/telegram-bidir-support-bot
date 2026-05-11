#!/usr/bin/env node
const base = process.argv[2] || 'http://127.0.0.1:3000';
const cookie = process.argv[3];
if (!cookie) {
  console.error('usage: check-session-cookie.mjs <base> <admin_session_cookie>');
  process.exit(2);
}
const res = await fetch(`${base}/admin`, { headers: { cookie: `admin_session=${cookie}` }, redirect: 'manual' });
const text = await res.text();
console.log('admin-with-session', res.status, /Telegram 客服后台/.test(text), /后台登录/.test(text));
process.exit(res.status === 200 && /Telegram 客服后台/.test(text) ? 0 : 1);
