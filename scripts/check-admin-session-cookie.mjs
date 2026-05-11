#!/usr/bin/env node
import Database from 'better-sqlite3';
import { createSessionCookie } from '../src/admin-auth.ts';

const base = process.argv[2] || 'http://127.0.0.1:3000';
const sqlitePath = process.argv[3] || 'data/telegram-support-bot.sqlite';
const db = new Database(sqlitePath);
const secret = db.prepare("select value from settings where key='encryption_secret'").pluck().get();
const owner = db.prepare("select value from settings where key='owner_ids'").pluck().get()?.split(',')[0]?.trim() || 'web-admin';
if (!secret) throw new Error('encryption_secret missing in db');
const cookie = (await createSessionCookie({ ENCRYPTION_SECRET: secret }, owner, false)).match(/admin_session=([^;]+)/)?.[1];
const res = await fetch(`${base}/admin`, { headers: { cookie: `admin_session=${cookie}` }, redirect: 'manual' });
const text = await res.text();
console.log('session-cookie', res.status, /Telegram 客服后台/.test(text));
if (res.status !== 200 || !/Telegram 客服后台/.test(text)) process.exit(1);
