import 'dotenv/config';
import http from 'node:http';
import dns from 'node:dns';
import path from 'node:path';
import { Agent, setGlobalDispatcher } from 'undici';
import { fileURLToPath } from 'node:url';

if (process.env.TELEGRAM_FORCE_IPV4 !== 'false') {
  setGlobalDispatcher(new Agent({
    connect: {
      lookup(hostname, options, callback) {
        dns.lookup(hostname, { ...options, family: 4 }, callback);
      },
    },
  }));
}
import { transcodeToMp3 } from './audio-cache';
import { handleRequest } from './app';
import { createNodeBindings } from './node-adapter';
import type { Env } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const publicUrl = process.env.PUBLIC_URL;

const bindings = createNodeBindings({
  databasePath: process.env.SQLITE_PATH ?? path.join(rootDir, 'data', 'telegram-support-bot.sqlite'),
  migrationsDir: path.join(rootDir, 'migrations'),
});

const env: Env = {
  BOT_TOKEN: process.env.BOT_TOKEN ?? '',
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
  SUPPORT_CHAT_ID: process.env.SUPPORT_CHAT_ID ?? '',
  PUBLIC_URL: process.env.PUBLIC_URL,
  OWNER_IDS: process.env.OWNER_IDS,
  BOT_USERNAME: process.env.BOT_USERNAME,
  DEFAULT_LANG: process.env.DEFAULT_LANG,
  RATE_LIMIT_COUNT: process.env.RATE_LIMIT_COUNT,
  RATE_LIMIT_WINDOW_SECONDS: process.env.RATE_LIMIT_WINDOW_SECONDS,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_MODEL: process.env.AI_MODEL,
  AI_SYSTEM_PROMPT: process.env.AI_SYSTEM_PROMPT,
  AI_AUTO_REPLY: process.env.AI_AUTO_REPLY,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET,
  KB_ENABLED: process.env.KB_ENABLED,
  TELEGRAM_API_BASE: process.env.TELEGRAM_API_BASE,
  AUDIO_TRANSCODE_URL: process.env.AUDIO_TRANSCODE_URL,
  AUDIO_TRANSCODE_SECRET: process.env.AUDIO_TRANSCODE_SECRET,
  DB: bindings.DB,
  KV: bindings.KV,
};

const server = http.createServer(async (req, res) => {
  try {
    const request = await toRequest(req);
    const response = await handleRequest(request, env, undefined, { transcodeAudioToMp3: transcodeToMp3 });
    await writeResponse(res, response);
  } catch (err) {
    console.error('request failed', err);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

server.listen(port, host, () => {
  console.log(`telegram-bidir-support-bot listening on http://${host}:${port}`);
  if (publicUrl) console.log(`public url: ${publicUrl}`);
});

async function toRequest(req: http.IncomingMessage): Promise<Request> {
  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  const hostHeader = req.headers['x-forwarded-host'] ?? req.headers.host ?? `localhost:${port}`;
  const url = `${proto}://${hostHeader}${req.url ?? '/'}`;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
  });
}

async function writeResponse(res: http.ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie' && setCookies.length) return;
    res.setHeader(key, value);
  });
  if (setCookies.length) res.setHeader('set-cookie', setCookies);
  if (!response.body) {
    res.end();
    return;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}
