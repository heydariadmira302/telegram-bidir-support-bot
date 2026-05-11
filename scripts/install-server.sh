#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Please install Node.js 20+ first." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "${NODE_MAJOR}" -lt 20 ]; then
  echo "Node.js 20+ is recommended. Current: $(node -v)" >&2
  exit 1
fi

npm install
mkdir -p data

if [ ! -f .env ]; then
  cat > .env <<'ENV'
BOT_TOKEN=
SUPPORT_CHAT_ID=
ADMIN_PASSWORD=
WEBHOOK_SECRET=
PORT=3000
SQLITE_PATH=./data/telegram-support-bot.sqlite
# OWNER_IDS=
# PUBLIC_URL=https://support.example.com
ENV
  echo "Created .env. Please fill BOT_TOKEN, SUPPORT_CHAT_ID, ADMIN_PASSWORD, and WEBHOOK_SECRET."
else
  echo ".env already exists; keeping it unchanged."
fi

cat <<'NEXT'

Next steps:
1. Edit .env and fill required values.
2. Start locally: npm run start:server
3. Check health: curl http://127.0.0.1:3000/health
4. Configure Nginx/Caddy reverse proxy with HTTPS.
5. Set webhook: curl 'https://your-domain/setup-webhook?key=WEBHOOK_SECRET'

NEXT
