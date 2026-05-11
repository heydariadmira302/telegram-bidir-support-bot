# Security Notes

## Required secrets

Set these in the deployment environment, not in Git:

```env
BOT_TOKEN=...
SUPPORT_CHAT_ID=...
WEBHOOK_SECRET=...
ADMIN_PASSWORD=...
ENCRYPTION_SECRET=...
KB_ENABLED=false
```

`ENCRYPTION_SECRET` is required before saving AI Provider API keys in the admin panel.
Use a long random value, preferably 32+ characters.

## Admin panel

- `/admin` is password protected with `ADMIN_PASSWORD`.
- Cookies are HttpOnly and SameSite=Lax.
- POST actions use CSRF protection.
- Login failures are rate-limited when KV is available.
- For production, consider adding an extra reverse-proxy layer: IP allowlist or Basic Auth.

## AI Provider API keys

- API keys entered in the admin panel are encrypted with `ENCRYPTION_SECRET`.
- The admin page only shows a masked key hint.
- Bot commands must not accept or display API keys.
- Prefer provider keys scoped to this bot/project rather than master account keys.

## Knowledge base

Knowledge base features are disabled by default:

```env
KB_ENABLED=false
```

Do not import raw Telegram history into a public server unless you have reviewed and desensitized it.
A safer workflow is:

1. Export Telegram JSON locally.
2. Clean and redact sensitive content offline.
3. Import only confirmed FAQ / safe knowledge entries.

When `KB_ENABLED=false`, the admin menu hides the knowledge base and AI does not read knowledge entries.

## Data files

Never commit these:

- `.env`
- `data/`
- `tmp/`
- `*.sqlite`
- `*.sqlite-*`

## High-risk operations

Use extra care with:

- Broadcasts
- Global AI auto reply
- Admin changes
- User blocking
- AI Provider key changes
- Knowledge imports

Global AI auto reply should remain off unless the support flow is well tested.

## Backups

Node.js / Docker SQLite backup example:

```bash
sqlite3 data/telegram-support-bot.sqlite ".backup backup-$(date +%F).sqlite"
```

Cloudflare D1 export example:

```bash
wrangler d1 export telegram_support_bot --remote --output backup.sql
```

Store backups privately and never commit them to Git.
