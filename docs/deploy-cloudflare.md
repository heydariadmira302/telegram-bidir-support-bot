# Cloudflare 部署教程（中文后台版）

这份教程按 Cloudflare 中文后台的实际操作思路来写，适合把本项目部署到 Cloudflare。

本项目支持两种 Cloudflare 入口，核心逻辑完全复用：

- **Workers 部署**：入口是 `src/worker.ts`，再进入 `src/app.ts`。
- **Pages Functions 部署**：入口是 `functions/[[path]].ts`，也进入同一个 `src/app.ts`。

数据层：

- **D1 数据库**：保存用户、Topic 映射、多 Bot、后台配置、消息记录等 SQL 数据。
- **KV 命名空间**：保存短期状态，比如防刷限流、后台 Telegram 登录验证码。KV 是必需绑定；后台 Telegram 验证码和登录失败限流依赖 KV。

Node.js 专用依赖已经隔离在 `src/server.ts`、`src/node-adapter.ts` 和 Caddy 辅助路径里；Cloudflare Worker/Pages 打包不会带 `better-sqlite3`、`node:http`、`fs`、`path`、`dotenv` 这类 Node-only 依赖。

## 0. 推荐部署方式

如果你只是想部署这个客服 Bot，我建议优先用：

**Workers + D1 + KV + 自定义域名 `https://support.example.com`**

原因：

- Workers 路由和 webhook 更直接。
- `wrangler.toml` 已经按 Workers 配好。
- Pages Functions 也支持，但更适合你同时有前端静态站点的场景。

## 1. 准备工作

你需要：

1. Cloudflare 账号，并能进入中文后台。
2. 本地/服务器有 Node.js 和 npm。
3. Telegram BotFather 创建的默认 Bot Token。
4. Telegram 后台客服群：必须是**超级群**，并开启**话题 / Topics / Forum**。
5. 把 Bot 拉进后台群，并设为管理员，给它发消息、创建话题等权限。

项目目录：

```bash
cd ~/telegram-bidir-support-bot
npm install
```

登录 Wrangler：

```bash
npx wrangler login
```

## 2. 在 Cloudflare 中文后台了解几个入口

Cloudflare 后台可能会随版本微调，但大体入口是这些：

- **Workers 和 Pages**：管理 Worker、Pages 项目、绑定、环境变量、部署。
- **存储和数据库 / D1 SQL 数据库**：创建和查看 D1 数据库。
- **Workers KV / KV**：创建 KV 命名空间。
- Worker 项目详情里通常有：
  - **设置**
  - **变量和机密 / Variables and Secrets**
  - **绑定 / Bindings**
  - **触发器 / Triggers**，用于自定义域名/路由
  - **日志 / 实时日志**，用于排查报错
- Pages 项目详情里通常有：
  - **设置**
  - **环境变量**
  - **绑定**
  - **函数 / Functions**
  - **自定义域**

官方文档确认：Pages Functions 的绑定在后台路径是 **Workers & Pages → 选择 Pages 项目 → Settings → Bindings → Add**；D1/KV 都可以通过绑定注入到 `context.env`。

## 3. 创建 D1 数据库

### 方式 A：命令行创建（推荐）

```bash
npx wrangler d1 create telegram_support_bot
```

输出里会有类似：

```toml
[[d1_databases]]
binding = "DB"
database_name = "telegram_support_bot"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把 `database_id` 填进 `wrangler.toml`。

注意：本项目代码里 D1 绑定名必须叫：

```text
DB
```

### 方式 B：Cloudflare 中文后台创建

1. 进入 Cloudflare 后台。
2. 找到 **存储和数据库** 或 **D1 SQL 数据库**。
3. 点击 **创建数据库**。
4. 数据库名称填：`telegram_support_bot`。
5. 创建后复制数据库 ID。
6. 回到项目，把 ID 填进 `wrangler.toml` 的 `database_id`。

## 4. 创建 KV 命名空间

### 方式 A：命令行创建（推荐）

```bash
npx wrangler kv namespace create TELEGRAM_SUPPORT_KV
```

把输出里的 KV `id` 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "KV"
id = "你的 KV namespace id"
```

注意：本项目代码里 KV 绑定名必须叫：

```text
KV
```

### 方式 B：Cloudflare 中文后台创建

1. 进入 **Workers 和 Pages** 或 **Workers KV**。
2. 找到 **KV** / **KV 命名空间**。
3. 点击 **创建命名空间**。
4. 名称可以填：`TELEGRAM_SUPPORT_KV`。
5. 创建后复制 ID，填进 `wrangler.toml`。

## 5. 配置 `wrangler.toml`

示例：

```toml
name = "telegram-bidir-support-bot"
main = "src/worker.ts"
compatibility_date = "2026-05-04"

[vars]
PUBLIC_URL = "https://support.example.com"
# OWNER_IDS = "123456789,987654321"
# SUPPORT_CHAT_ID = "-1001234567890"
# SUPPORT_CARD_FALLBACK = "true"

[[d1_databases]]
binding = "DB"
database_name = "telegram_support_bot"
database_id = "你的 D1 database_id"

[[kv_namespaces]]
binding = "KV"
id = "你的 KV namespace id"
```

说明：

- `PUBLIC_URL`：你的公网域名，比如 `https://support.example.com`。
- `SUPPORT_CHAT_ID`：旧部署/默认 Bot 可以填。多 Bot SaaS 流程里，新 Bot 可以不填，后面用 `/setup` 或 `/bind` 在群里绑定。
- `OWNER_IDS`：管理员 Telegram 数字 ID，建议配置。
- `SUPPORT_CARD_FALLBACK`：复制消息不能编辑时是否自动补发资料卡/统计卡。默认开启；填 `false` 可关闭。

不要把真实 Token、密码、加密密钥写进 `wrangler.toml`。

## 6. 配置 Secrets / 环境变量

### Workers 命令行配置

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put ENCRYPTION_SECRET
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put OWNER_IDS
```

可选 AI：

```bash
npx wrangler secret put AI_API_KEY
npx wrangler secret put AI_BASE_URL
npx wrangler secret put AI_MODEL
```

可选语音 MP3 转码服务（Cloudflare 不能本地运行 ffmpeg；不配置时会直接代理 Telegram 原始语音文件）：

```bash
npx wrangler secret put AUDIO_TRANSCODE_URL
npx wrangler secret put AUDIO_TRANSCODE_SECRET
```

每个变量含义：

- `BOT_TOKEN`：默认 Bot Token。
- `WEBHOOK_SECRET`：默认 Bot webhook secret。Telegram 会用请求头 `x-telegram-bot-api-secret-token` 传过来。
- `ENCRYPTION_SECRET`：至少 16 位，强烈建议随机长字符串。用于 Web Crypto AES-GCM 加密保存多 Bot Token、AI Provider Key。
- `ADMIN_PASSWORD`：Web 后台 `/admin` 登录密码。
- `OWNER_IDS`：owner 管理员 Telegram 数字 ID，多个用英文逗号分隔。
- `PUBLIC_URL`：可放 `wrangler.toml` 的 `[vars]`，不一定要 secret。
- `AUDIO_TRANSCODE_URL`：可选。外部音频转码 HTTP 服务地址；Cloudflare Worker/Pages 自身不能运行 `ffmpeg`，需要 MP3 兼容播放时才配置。
- `AUDIO_TRANSCODE_SECRET`：可选。调用外部转码服务时发送 `Authorization: Bearer ...`。

重要：`ENCRYPTION_SECRET` 设置后要保持稳定。以后如果改了，旧的加密 Bot Token 会解不开，除非重新保存 Token。

### 语音播放与 Cloudflare 兼容性

Telegram 语音通常是 OGG/Opus。Node.js / VPS 部署可以用本机 `ffmpeg` 转成 MP3 后播放；Cloudflare Worker / Pages 不能运行本地程序、也不能写本地文件缓存，所以本项目在 Cloudflare 中保持以下行为：

- 未配置 `AUDIO_TRANSCODE_URL`：直接代理 Telegram 原始语音文件，兼容性取决于浏览器。
- 已配置 `AUDIO_TRANSCODE_URL`：Worker 把原始音频 POST 给外部转码服务，服务返回 `audio/mpeg` 后再给后台播放器。

转码服务约定：接收原始音频二进制 `POST` body，返回 MP3 二进制，响应 `Content-Type: audio/mpeg`。

### Workers 中文后台配置位置

如果你想在后台看/配：

1. 进入 **Workers 和 Pages**。
2. 点进你的 Worker：`telegram-bidir-support-bot`。
3. 进入 **设置**。
4. 找 **变量和机密** 或 **环境变量**。
5. 添加变量/机密。

一般建议：

- 普通配置：`PUBLIC_URL`、`OWNER_IDS` 可用变量。
- 敏感配置：`BOT_TOKEN`、`WEBHOOK_SECRET`、`ENCRYPTION_SECRET`、`ADMIN_PASSWORD` 用机密/Secret。

## 7. D1 建表 / migrations

本项目所有表结构在 `migrations/` 目录里，当前包含到：

```text
0016_bot_bind_codes.sql
```

对新手最简单的方式：**不用手动执行命令**。只要 D1 已绑定，首次打开 `/install` 时，系统会检测空 D1 数据库并自动建表。

只有这些场景才需要手动执行 migrations：

- 你想用命令行预先建表。
- 你在升级一个已有旧数据库。
- `/install` 提示数据库不是空库，自动建表被拒绝。

手动执行生产 D1 migrations：

```bash
npm run db:migrate:remote
```

等价命令：

```bash
npx wrangler d1 migrations apply telegram_support_bot --remote
```

本地开发执行：

```bash
npm run db:migrate:local
```

D1 兼容说明：

- 当前 migrations 使用 D1 支持的 SQLite 语法：`ALTER TABLE ... ADD COLUMN`、`CREATE INDEX IF NOT EXISTS`、`INSERT ... ON CONFLICT`、`CURRENT_TIMESTAMP` 等。
- `0014_tenant_scoped_settings_and_keys.sql` 会重建部分表，把 settings、快捷回复、关键词等改成 workspace/Bot scoped。老数据库升级前建议备份。
- D1 migration 按文件名记录执行状态，已经上线的 migration 文件不要随便改名。

## 8. 部署到 Workers

Workers 部署有两种方式，推荐用 Wrangler 从仓库发布。不要在 Cloudflare 在线编辑器里手写 `worker.js`，否则它会保持默认 `Hello world` 示例代码。

### 方式 A：本地/服务器用 Wrangler 发布（推荐）

如果你用 `npx wrangler deploy` / `npm run deploy` 发布 Worker，必须先确保 `wrangler.toml` 里的 D1/KV ID 已经替换成真实值：

```toml
[[d1_databases]]
binding = "DB"
database_name = "telegram_support_bot"
database_id = "真实 D1 database_id"

[[kv_namespaces]]
binding = "KV"
id = "真实 KV namespace_id"
```

说明：这是 **Wrangler 部署方式** 的要求。Wrangler 会按 `wrangler.toml` 打包和上传 Worker metadata；如果里面还是 `REPLACE_WITH_...` 占位符，部署会失败。D1 database_id / KV namespace_id 不是 Token，不是密钥，放在仓库配置里通常可以接受。

如果你用 **Pages 部署**，或纯在 Cloudflare 后台手动管理绑定，则不需要靠 `wrangler.toml` 里的 ID；后台绑定 `DB` / `KV` 即可。

检查类型：

```bash
npm run typecheck
```

部署：

```bash
npm run deploy
# 等价于：npx wrangler deploy
```

部署成功后，Cloudflare Worker 在线编辑器里不应该再是 `return new Response("Hello world")`；入口应该来自本仓库的 `src/worker.ts` 打包代码。

### 方式 B：Workers 连接 GitHub 自动部署

如果你是在 Cloudflare 后台创建 Worker 并连接 GitHub：

1. 进入 **Workers 和 Pages**。
2. 创建/选择 Worker。
3. 连接 GitHub 仓库：`heydariadmira302/telegram-bidir-support-bot`。
4. 构建命令：`npm run typecheck`。
5. 部署命令：`npx wrangler deploy` 或 `npm run deploy`。
6. 确保构建环境能读取仓库里的 `wrangler.toml`，且 D1/KV ID 不是占位符。

注意：Worker 的 GitHub 自动部署和 Pages 不一样。Worker 使用 `npx wrangler deploy` 时，绑定配置来自 `wrangler.toml`；Pages 项目则可以在后台绑定 `DB` / `KV`，不需要在 `wrangler.toml` 填 ID。

### 部署后检查

```bash
curl https://support.example.com/health
```

返回：

```text
OK
```

设置默认 Bot webhook：

```bash
curl 'https://support.example.com/setup-webhook?key=你的_WEBHOOK_SECRET'
```

成功后默认 Bot 的 Telegram webhook 是：

```text
https://support.example.com/telegram/webhook
```

## 9. 给 Worker 绑定自定义域名

中文后台常见路径：

1. 进入 **Workers 和 Pages**。
2. 点进 Worker：`telegram-bidir-support-bot`。
3. 找 **触发器** / **Triggers**。
4. 找 **自定义域** / **Custom Domains**。
5. 添加：`support.example.com`。
6. 确认 DNS 记录自动创建或手动按提示添加。

然后把 `PUBLIC_URL` 设置为：

```text
https://support.example.com
```

如果你暂时不用自定义域，也可以用 workers.dev 地址，例如：

```text
https://telegram-bidir-support-bot.xxx.workers.dev
```

## 10. Pages Functions 部署方式

如果你选择 Pages：

1. 进入 Cloudflare 后台 **Workers 和 Pages**。
2. 点击 **创建应用程序**。
3. 选择 **Pages**，连接 GitHub 仓库：`heydariadmira302/telegram-bidir-support-bot`。
4. 构建设置建议这样填：

   | Cloudflare Pages 后台字段 | 推荐填写 |
   | --- | --- |
   | 框架预设 / Framework preset | `无 / None` |
   | 构建命令 / Build command | `npm run typecheck` |
   | 构建输出目录 / Build output directory | `public` |
   | 根目录 / Root directory | 留空，或填 `/`；如果后台必须填，就填仓库根目录 |
   | Functions 目录 / Functions directory | 如果后台有这个字段就填 `functions`；如果找不到这个字段，直接跳过 |

   说明：这个项目不是传统前端静态站，不需要 `npm run build` 生成 `dist`。仓库里提供了一个很小的 `public/index.html` 作为 Pages 静态输出目录；真正的接口和后台由 `functions/[[path]].ts` 接管。Cloudflare Pages 会按约定自动识别仓库根目录下的 `functions/[[path]].ts`；新版中文后台如果没有显示 Functions 目录字段，不用管。

5. 关于你问的 **部署命令 / Deploy command**：

   - 如果后台允许留空：留空。
   - 如果新版中文后台强制必填：填一个空操作命令：`echo "Pages auto deploy"`。
   - 真正执行检查的是 **构建命令**，这里填 `npm run typecheck`。
   - Cloudflare Pages 会自动完成上传和部署，不需要再填 `wrangler pages deploy`。
   - 更不要填 `npx wrangler deploy`：这是 Workers 部署命令，不是 Pages GitHub 自动部署命令。填了以后构建机会按 Worker 方式读取 `wrangler.toml`，如果里面还是占位 KV/D1 ID，就会报 `KV namespace 'REPLACE_WITH_YOUR_KV_NAMESPACE_ID' is not valid`。
   - `package.json` 里的 `npm run deploy:pages` 是给命令行手动部署用的，不是 GitHub 自动部署后台要填的。

6. 高级设置里的 **非生产分支** 建议：

   | 字段 | 推荐填写 |
   | --- | --- |
   | 生产分支 / Production branch | `main` |
   | 非生产分支部署命令 / Preview build command | 留空，或同样填 `npm run typecheck` |
   | 非生产分支构建输出目录 / Preview output directory | 留空，或同样填 `public` |
   | 非生产分支根目录 / Preview root directory | 留空 |

   最稳妥的填法：**非生产分支全部留空**，让它继承生产环境设置。只有你想让预览分支跑不同命令时，才单独填写。

7. 部署后进入项目 **设置**。
8. 进入 **绑定**，添加：
   - D1 数据库绑定：变量名 `DB`，选择 `telegram_support_bot`。
   - KV 命名空间绑定：变量名 `KV`，选择 `TELEGRAM_SUPPORT_KV`。
9. 进入 **环境变量**：

   首次部署时可以**不先填写任何业务环境变量**。只要 `DB` / `KV` 绑定好了，部署成功后直接打开 `/install`，初始化页会根据你当前访问的域名自动预填 `PUBLIC_URL`。

   下面这些**不是必须先在 Cloudflare 填**，可以部署成功后打开项目自带的 `/install` 初始化网页填写：

   - `BOT_TOKEN`
   - `WEBHOOK_SECRET`
   - `ENCRYPTION_SECRET`
   - `OWNER_IDS`
   - `ADMIN_PASSWORD`
   - `PUBLIC_URL`

   如果你不想用网页初始化，也可以把它们作为 Cloudflare 机密/环境变量提前填好。

   `PUBLIC_URL` 的作用：让后台以后能稳定生成 Telegram webhook URL。首次初始化时它会从当前 `/install` 访问地址自动预填；如果后面从 `pages.dev` 换成自定义域名 `support.example.com`，再去后台或环境变量里更新即可。

10. 重新部署一次，让绑定生效。
11. 打开初始化页：`https://你的域名/install`，在网页中填写 Bot Token、Owner ID、Webhook Secret、加密密钥等。

Pages webhook 路由和 Workers 一样：

```text
默认 Bot:   https://你的-pages-域名/telegram/webhook
多 Bot:     https://你的-pages-域名/telegram/webhook/<botId>
```

设置默认 Bot webhook：

```bash
curl 'https://你的-pages-域名/setup-webhook?key=你的_WEBHOOK_SECRET'
```

## 11. 多 Bot SaaS 流程

旧部署兼容默认 Bot：

```text
/telegram/webhook
```

非默认 Bot 使用：

```text
/telegram/webhook/<botId>
```

推荐新增 Bot 流程：

1. 打开后台：`https://support.example.com/admin`。
2. 进入 **Bot 管理**：`/admin?page=bots`。
3. 添加 Bot：填名称 + Token。
4. 系统自动生成：
   - Bot ID
   - Webhook Secret
   - Webhook URL
   - 如果没填后台群，则生成 bind code
5. 快速激活会自动调用 Telegram：
   - `setWebhook`
   - `setMyCommands`
6. 把这个新 Bot 拉进一个开启 Topics 的 Telegram 后台群，并设为管理员。
7. 在群里发送：

```text
/setup
```

或：

```text
/bind TG-XXXX
```

8. 首次绑定成功后，该 Bot 的 `support_chat_id` 会保存到 D1。
9. 已绑定后再次 `/setup` 只显示状态，不会偷偷改绑。
10. 如果确实要换后台群，在 Web 后台高级配置里手动改 `support_chat_id`。

安全规则：

- 未绑定的新 Bot 不会复用旧的 `SUPPORT_CHAT_ID`。
- 每个 Bot 独立保存 token、webhook secret、public_url、support_chat_id、用户、快捷回复、关键词、settings。
- Telegram 和 Web 后台只是交互层；核心能力放在 `src/services/*` 和 Admin API，Node.js / Cloudflare 复用同一套 service 逻辑。

## 12. Telegram 功能验收

部署后可以这样验：

1. 用户私聊 Bot 发 `/start` 或任意消息。
2. 后台 Forum 群应自动创建一个独立 Topic。
3. 用户消息进入这个 Topic。
4. Topic 消息下方应有快捷按钮：
   - 用户资料
   - 互动统计
   - 待跟进 / 已处理
   - 拉黑 / 解除拉黑
5. 如果 Telegram 报 `copied message can't be edited`，资料卡/统计卡会自动补发。
6. 群里 `/welcome` 会进入欢迎语输入流程；5 分钟内发下一条非命令文本即可保存。
7. `/workbench` 打开客服工作台。
8. `/check` 查看部署自检。

## 13. API 验收

登录后台后可以检查：

```text
GET /admin/api/workbench
GET /admin/api/workbench/stats
GET /admin/api/user/stats?id=<telegramUserId>
GET /admin/api/bots
```

其中：

- `/admin/api/workbench` 返回 `summary + stats`。
- `/admin/api/workbench/stats` 返回工作台统计。
- `/admin/api/user/stats` 返回用户互动统计。
- Web 后台和 Telegram 统计卡都走 service/API 逻辑，不是只写在展示层。

## 14. 常见问题排查

### webhook 403

原因通常是 secret 不匹配。

检查：

- 默认 Bot 的 `WEBHOOK_SECRET` 是否和 Telegram webhook 安装时一致。
- 多 Bot 的 D1 `webhook_secret` 是否和安装 webhook 时一致。
- Telegram 请求头 `x-telegram-bot-api-secret-token` 会被项目校验。
- 默认 Bot 用 `/telegram/webhook`，非默认 Bot 用 `/telegram/webhook/<botId>`。

处理：

```bash
curl 'https://support.example.com/setup-webhook?key=你的_WEBHOOK_SECRET'
```

非默认 Bot 建议在 `/admin?page=bots` 里重新安装 webhook 或重新快速激活。

### Bot not found or disabled

说明路径里的 `<botId>` 没找到，或 Bot 被停用。

检查：

- `/admin?page=bots` 里 Bot 是否存在且启用。
- webhook URL 是否写错。
- D1 migrations 是否已经执行到 `0016_bot_bind_codes.sql`。

### message_thread_id / Topics 问题

检查：

- 后台群是不是超级群。
- 是否开启 Topics / 话题。
- Bot 是否是管理员。
- Bot 是否有创建/管理话题、发消息权限。
- 如果某个 Topic 被手动删除，下一条用户消息会尝试自动重建 Topic。

### D1 migration 失败

检查：

- `wrangler.toml` 里的 D1 `database_id` 是否正确。
- D1 绑定名必须是 `DB`。
- 命令是否加了 `--remote`。
- 老数据库升级前是否备份；`0014` 有表重建逻辑。

重试：

```bash
npm run db:migrate:remote
```

### Cloudflare 变量/Secret 缺失

常见报错：

- `DB is not bound`：D1 没绑定，或变量名不是 `DB`。
- `ENCRYPTION_SECRET is required`：没设置加密密钥，无法保存/解密多 Bot Token。
- `/admin` 404 或 Admin disabled：没设置 `ADMIN_PASSWORD`，也没配置 Telegram 登录所需的 `KV + BOT_TOKEN + OWNER_IDS`。

### Telegram 命令菜单没更新

`setMyCommands` 会在这些时候执行：

- `/setup-webhook`
- Web 后台安装 webhook
- 新 Bot 快速激活

Telegram 客户端可能缓存命令菜单，等几分钟或重启 Telegram 客户端。

### copied message can't be edited

Telegram 复制出来的消息经常不能编辑。项目已处理：

- 编辑失败时自动在同 Topic 补发资料卡/统计卡。
- 如果你不想自动补发，设置：

```text
SUPPORT_CARD_FALLBACK=false
```

### Pages 访问 `/install` 报 `Error 1101 Worker threw exception`

这说明 Pages Function 已经跑起来了，但运行时报错。最常见原因：

1. D1 没绑定，或绑定变量名不是 `DB`。
2. 绑定到了错误的 D1 数据库。
3. D1 不是空库，但缺少本项目需要的表，自动建表为保护数据而停止。

处理：

1. 进入 Pages 项目 **设置 → 绑定**，确认 D1 绑定变量名是 `DB`。
2. 确认绑定的数据库是 `telegram_support_bot`，最好是一个新的空 D1。
3. 重新打开 `/install`；新版本会自动给空 D1 建表，不需要你手动执行 wrangler migrations。
4. 如果仍然 1101，打开 Cloudflare Pages 项目的 **函数日志 / 实时日志**，看具体异常。

新版代码会尽量把 DB 未绑定 / 数据库不是空库等问题显示成中文错误页，而不是直接 1101。

### Pages 报错：`Output directory "public" not found`

这说明 Cloudflare Pages 当前拉到的 GitHub 代码里没有 `public/` 目录。常见原因是部署的 fork/分支落后于最新 main。

排查日志里这两行：

```text
From https://github.com/<你的账号>/telegram-bidir-support-bot
HEAD is now at <commit>
```

如果 commit 还停在 `8fc2460` 或早于 `11b7fb8`，说明代码太旧，还没有 `public/index.html`。

处理方式：

1. 在 GitHub 把你的 fork 同步到最新 main，或重新选择最新仓库。
2. 确认仓库里存在：`public/index.html`。
3. 重新部署 Pages。
4. 如果暂时不想同步代码，临时把 Pages **构建输出目录** 改回 `.` 也能继续部署，但推荐同步代码后使用 `public`。

### 访问 `/install` 显示 `Hello world`

这不是本项目自己的初始化页。本项目的 `/install` 页面标题应该是：`初始化 Telegram 客服 Bot`。

常见原因：

1. Worker 在线编辑器里的代码还是默认示例：`return new Response("Hello world")`。
2. 访问的域名还指向旧 Worker / 示例 Worker。
3. Cloudflare Pages 项目不是从 `heydariadmira302/telegram-bidir-support-bot` 最新 main 分支部署的。
4. Pages 构建设置的输出目录/命令错误，导致部署的是示例项目。
5. 自定义域名绑到了另一个 Worker/Pages 项目。

排查顺序：

1. 如果你用 Workers 部署，进入 Worker 在线编辑器看代码：如果还是 `return new Response("Hello world")`，说明还没把 GitHub 仓库代码发布到这个 Worker。请用 `npm run deploy` / GitHub 自动部署重新发布。
2. 如果你用 Pages 部署，先访问 Cloudflare Pages 自动分配的域名，而不是自定义域名，例如：`https://你的-pages-项目.pages.dev/health`。
3. 正常应该返回：`OK`。
4. 再访问：`https://你的-pages-项目.pages.dev/install`。
5. 正常应该看到：`初始化 Telegram 客服 Bot`。
6. 如果 pages.dev 域名正常，但自定义域名显示 `Hello world`，说明自定义域名绑错项目或 DNS/路由还指向旧 Worker。
7. 如果 pages.dev 域名也显示 `Hello world`，进入 Pages 的 **部署详情**，确认 Git commit 是最新 main，并检查构建设置：
   - Build command: `npm run typecheck`
   - Deploy command: `echo "Pages auto deploy"`
   - Build output directory: `public`
   - Root directory: 留空
8. 在部署日志里确认有 clone 仓库 `telegram-bidir-support-bot`，并且不是 Cloudflare 示例 Hello World 项目。

### Pages 构建日志出现 `Executing user deploy command: npx wrangler deploy`

这说明 Pages 后台的 **部署命令 / Deploy command** 被填成了 `npx wrangler deploy`。

处理：

1. 进入 Pages 项目设置。
2. 找到构建/部署设置。
3. 把 **部署命令 / Deploy command** 清空。
4. 如果 **部署命令 / Deploy command** 必填，填：`echo "Pages auto deploy"`。
5. 保留 **构建命令 / Build command**：`npm run typecheck`。
6. 保留 **构建输出目录 / Build output directory**：`public`。
7. 保存后重新部署。

不要在 Pages GitHub 自动部署里填 `npx wrangler deploy`，否则会变成 Worker 部署，并读取 `wrangler.toml` 里的占位 ID。

### `KV namespace 'REPLACE_WITH_YOUR_KV_NAMESPACE_ID' is not valid`

分两种情况：

- 如果你是在 **Pages GitHub 自动部署**：大概率是误填了部署命令 `npx wrangler deploy`。清空部署命令即可，然后在 Pages 后台的 **绑定** 里绑定 KV，变量名填 `KV`。
- 如果你是在 **Workers 部署**：就必须先创建 KV 命名空间，并把 `wrangler.toml` 里的 `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` 换成真实 KV namespace id。

### KV 没绑定会怎样

- 用户防刷限流不可用，但消息流程不崩。
- 密码登录防爆破限流不可用。
- Telegram 登录验证码不可用，登录失败限流也不可用；正式部署必须绑定 KV。
- `/welcome` 的等待输入状态当前保存在 tenant-scoped settings 表，5 分钟有效，不依赖 KV。

## 15. 上线前最终检查清单

```bash
npm run typecheck
git diff --check
npx wrangler deploy --dry-run --outdir /tmp/tg-bidir-worker-smoke
```

再检查 Worker bundle 里不要出现 Node-only 依赖：

```bash
grep -R "better-sqlite3\|node:http\|node:fs\|dotenv/config" -n /tmp/tg-bidir-worker-smoke || true
```

线上检查：

```bash
curl https://support.example.com/health
curl 'https://support.example.com/setup-webhook?key=你的_WEBHOOK_SECRET'
```

然后在 Telegram：

- 后台群 `/check`
- 后台群 `/setup`
- 用户私聊 Bot 发消息
- 后台 Topic 回复用户
- Web 后台 `/admin`
