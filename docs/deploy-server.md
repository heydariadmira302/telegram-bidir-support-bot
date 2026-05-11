# Server Deployment Guide

This guide covers VPS, aaPanel/宝塔, 1Panel, Docker Compose, systemd, and reverse proxy deployment for the Node.js server runtime.

## Requirements

- Node.js 20+ recommended
- npm 10+
- A Telegram bot token from BotFather
- A Telegram supergroup with Topics enabled for `SUPPORT_CHAT_ID`
- Bot added as admin in the support group
- A strong `ADMIN_PASSWORD`

Minimum environment variables:

```env
BOT_TOKEN=123456:telegram-bot-token
SUPPORT_CHAT_ID=-1001234567890
ADMIN_PASSWORD=change-me
WEBHOOK_SECRET=random-long-secret
PORT=3000
SQLITE_PATH=./data/telegram-support-bot.sqlite
```

Optional:

```env
OWNER_IDS=123456789,987654321
PUBLIC_URL=https://support.example.com
RATE_LIMIT_COUNT=8
RATE_LIMIT_WINDOW_SECONDS=60
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

## VPS Deployment

```bash
git clone https://github.com/heydariadmira302/telegram-bidir-support-bot.git
cd telegram-bidir-support-bot
bash scripts/install-server.sh
npm run start:server
```

Open another shell and check:

```bash
curl http://127.0.0.1:3000/health
```

Expected output:

```text
OK
```

Then configure your public reverse proxy and set the webhook:

```bash
curl 'https://your-domain.example/setup-webhook?key=YOUR_WEBHOOK_SECRET'
```

## 宝塔 / aaPanel Deployment

1. Create a site in 宝塔 and bind your domain.
2. Install Node.js 20+ in the Node project manager, or install it through the terminal.
3. Upload or clone this repository to the site directory.
4. Run:

   ```bash
   npm install
   cp .env.example .env 2>/dev/null || touch .env
   nano .env
   ```

5. Configure a Node project:
   - Startup file: `src/server.ts`
   - Run command: `npm run start:server`
   - Port: same as `PORT` in `.env`, for example `3000`
6. Add reverse proxy to `http://127.0.0.1:3000`.
7. Visit `/health`, then `/setup-webhook?key=WEBHOOK_SECRET`.

## 1Panel Deployment

1. Create a Node.js application or use the terminal in 1Panel.
2. Clone the repository.
3. Configure `.env` with the required variables.
4. Start with:

   ```bash
   npm install
   npm run start:server
   ```

5. In Website → Reverse Proxy, proxy the domain to `127.0.0.1:3000`.
6. Enable HTTPS.
7. Set Telegram webhook with `/setup-webhook?key=WEBHOOK_SECRET`.

## Docker Compose Deployment

Create `.env` first, then run:

```bash
docker compose up -d --build
```

Check logs:

```bash
docker compose logs -f
```

Health check:

```bash
curl http://127.0.0.1:3000/health
```

Persist SQLite by mounting `./data` as defined in `docker-compose.yml`.

## systemd Deployment

Example service file `/etc/systemd/system/telegram-bidir-support-bot.service`:

```ini
[Unit]
Description=Telegram Bidirectional Support Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/telegram-bidir-support-bot
EnvironmentFile=/opt/telegram-bidir-support-bot/.env
ExecStart=/usr/bin/npm run start:server
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable --now telegram-bidir-support-bot
systemctl status telegram-bidir-support-bot
```

## Nginx Reverse Proxy Example

```nginx
server {
  listen 80;
  server_name support.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name support.example.com;

  ssl_certificate /etc/letsencrypt/live/support.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/support.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

## Caddy Example

```caddyfile
support.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Caddy will request and renew TLS certificates automatically.

## Common Issues

### `/admin` returns 401

This is expected before login. Open `/admin` in a browser and log in with `ADMIN_PASSWORD`.

### Telegram webhook does not deliver messages

Check:

- Domain uses HTTPS.
- `WEBHOOK_SECRET` in `.env` matches `/setup-webhook?key=...`.
- Bot is admin in the support group.
- Support group has Topics enabled.
- `SUPPORT_CHAT_ID` starts with `-100` for supergroups.

### SQLite permission errors

Make sure the service user can write to the directory containing `SQLITE_PATH`:

```bash
mkdir -p data
chown -R <service-user>:<service-user> data
```

### Reverse proxy works but webhook fails

Confirm proxy headers and public URL:

```bash
curl https://support.example.com/health
```

Expected:

```text
OK
```

Then reset webhook:

```bash
curl 'https://support.example.com/setup-webhook?key=WEBHOOK_SECRET'
```
