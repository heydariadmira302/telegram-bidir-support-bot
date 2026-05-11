# Telegram 双向客服 Bot

一个支持 Cloudflare Worker / Pages 和普通 Node.js 服务器部署的 Telegram 双向客服机器人。

## 能解决什么

用户不能直接私信你时，让用户私聊 bot：

```text
用户 A 私聊 bot  ⇄  管理群 Topic A
用户 B 私聊 bot  ⇄  管理群 Topic B
```

bot 会给每个用户在你的 Telegram Forum 管理群里自动创建一个 Topic。你在对应 Topic 里直接发消息，bot 会转回给那个用户，所以多人同时发消息也不会乱。

## 功能

- 用户私聊 bot，自动转发到管理群
- 每个用户一个 Forum Topic
- 管理员在 Topic 里直接回复，bot 自动回给原用户
- 支持文本、图片、文件、语音、视频等 Telegram `copyMessage` 支持的消息类型
- Cloudflare D1 或服务器 SQLite 保存用户和 Topic 映射
- 可选 `OWNER_IDS` 限制只有指定管理员能回复
- `/block` `/unblock` 拉黑/解除用户
- `/note` 用户备注、`/info` 用户资料卡
- `/close` `/open` 会话状态
- `/quick` 快捷回复
- `/welcome` 自定义欢迎语
- `/kw` 关键词自动回复
- `/tag` 用户标签
- `/ai` AI 回复草稿，可选 `/ai_on` 单用户自动回复、`/ai_auto` 全局自动回复
- `/admin` 动态管理员管理
- `/users` `/recent` `/pending` 用户列表与待处理队列
- `/broadcast` + `/confirm_broadcast` 二次确认广播
- `/contact` 获取对方公开 username / t.me 链接 / Telegram 数字 ID
- Web 后台 `/admin`，支持用户列表、待处理、备注、标签、快捷回复、关键词管理、用户状态操作、最近消息记录、设置页、敏感词和广播二次确认
- 敏感词提醒
- `/check` 部署自检
- KV 防刷限流和后台 Telegram 验证码登录
- `/setup` 后台群初始化助手，方便拿群 ID / 管理员 ID / Topics 状态
- Worker、Pages Functions、Node.js 服务器三种入口

## 准备

1. 找 BotFather 创建 bot，拿到 `BOT_TOKEN`。
2. 创建一个 Telegram 超级群，开启 Topics/话题。
3. 把 bot 拉进这个群，并设为管理员。
4. 在群里发 `/id` 前，你还不知道群 ID，可以临时用下面方式之一获取：
   - 用第三方 get id bot；或
   - 先部署后，把 `SUPPORT_CHAT_ID` 配成你查到的 `-100...` 群 ID。

> 注意：Topic 模式要求后台群必须开启 Forum Topics。

## Cloudflare 部署

完整中文后台版教程见：[`docs/deploy-cloudflare.md`](docs/deploy-cloudflare.md)。里面按 Cloudflare 中文界面的 **Workers 和 Pages / D1 SQL 数据库 / KV / 变量和机密 / 绑定 / 触发器** 来写。项目同时支持：

- **Workers**：入口 `src/worker.ts`，路由进 `src/app.ts`。
- **Pages Functions**：入口 `functions/[[path]].ts`，复用同一个 `src/app.ts`。

快速流程：

```bash
npm install
npx wrangler d1 create telegram_support_bot
npx wrangler kv namespace create TELEGRAM_SUPPORT_KV
# 把 D1 database_id 和 KV id 填入 wrangler.toml
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put ENCRYPTION_SECRET
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put OWNER_IDS
npm run db:migrate:remote
npm run typecheck
npm run deploy
```

`wrangler.toml` 的 `[vars]` 至少建议配置：

```toml
PUBLIC_URL = "https://你的域名"
# SUPPORT_CHAT_ID = "-1001234567890" # 默认 Bot/旧部署可选；新 Bot 可用 /setup 或 /bind 绑定
```

设置默认 Bot webhook：

```text
https://你的域名/setup-webhook?key=你的WEBHOOK_SECRET
```

Webhook 路由：

```text
默认 Bot:     https://你的域名/telegram/webhook
非默认 Bot:   https://你的域名/telegram/webhook/<botId>
```

Pages 部署时，在 Cloudflare Pages 中文后台里给项目绑定 `DB`/`KV`，配置同样的环境变量/机密，Build command 用 `npm run typecheck`，输出目录用 `public`；如果 Deploy command 必填，填 `echo "Pages auto deploy"`；Functions 目录字段有就填 `functions`，没有就跳过。

## 服务器部署（Node.js + SQLite）

服务器部署适合你有 VPS / 宝塔 / 1Panel / Docker / systemd 的场景。数据默认保存在本地 SQLite，不依赖 Cloudflare D1。

```bash
git clone https://github.com/heydariadmira302/telegram-bidir-support-bot.git
cd telegram-bidir-support-bot
npm install
cp .env.example .env
```

编辑 `.env`：

```text
BOT_TOKEN=你的BotToken
SUPPORT_CHAT_ID=-100你的后台群ID
WEBHOOK_SECRET=一串长随机字符串
ADMIN_PASSWORD=后台强密码
PUBLIC_URL=https://你的域名
PORT=3000
SQLITE_PATH=./data/telegram-support-bot.sqlite
```

启动：

```bash
npm run dev:server
```

生产环境可以用：

```bash
npm run start:server
```

也可以用 Docker Compose：

```bash
cp .env.example .env
# 编辑 .env 后启动
docker compose up -d --build
```

然后用 Nginx / Caddy 反代到 `127.0.0.1:3000`，并配置 HTTPS。

设置 webhook：

```text
https://你的域名/setup-webhook?key=你的WEBHOOK_SECRET
```

打开一次即可。后台地址：

```text
https://你的域名/admin
```

### 多 Bot / 多租户入口

- 默认 Bot 兼容旧部署，webhook 仍是 `/telegram/webhook`。
- 非默认 Bot webhook：`/telegram/webhook/<botId>`。
- Bot 管理页：`/admin?page=bots`，新增 Bot 后系统会生成 Bot ID、Webhook Secret、Webhook URL；快速激活会自动安装 webhook 并设置 Telegram 命令菜单。
- 新 Bot 未填写后台群时，会生成绑定码。把 Bot 拉进一个已开启 Topics 的后台 Forum 群后，发送 `/setup` 或 `/bind <code>` 绑定第一个后台群。
- 已绑定 Bot 再次 `/setup` 只显示状态，不会自动改绑；需要更换时用后台高级 `support_chat_id` 字段手动处理。
- 非默认 Bot 不会复用旧 `SUPPORT_CHAT_ID`，避免多个 Bot 串到同一个后台群。
- 后台按 Bot 切换：`/admin?page=users&workspace=<workspaceId>&bot=<botId>`，用户、待处理、快捷回复、关键词、广播、settings 会按当前 Bot 隔离。
- Admin API 优先作为管理入口；Web 后台和 Telegram 只是展示/交互层。API 见 `docs/api.md`。

### systemd 示例

```ini
[Unit]
Description=Telegram bidirectional support bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/telegram-bidir-support-bot
ExecStart=/usr/bin/npm run start:server
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

建议用 `.env` 或 systemd `EnvironmentFile=` 管理密钥，不要把真实密钥写进仓库。

## 更方便地添加后台群

1. 创建 Telegram 超级群。
2. 在群设置里开启 Topics/话题。
3. 把 bot 拉进群，并设为管理员。
4. 在群里发送：

```text
/setup
```

bot 会自动回复：

- 当前群 ID，也就是 `SUPPORT_CHAT_ID`
- 你的 Telegram 数字 ID，也就是 `OWNER_IDS`
- 当前群是否开启 Topics
- 下一步应该填哪些 Cloudflare 环境变量

这样不用到处找 `-100...` 群 ID。

## Web 后台

在 Cloudflare 项目的环境变量里设置：

```text
ADMIN_PASSWORD=一个强密码
```

不要把 `ADMIN_PASSWORD` 写进 `wrangler.toml`、代码或 GitHub 仓库。

部署后打开：

```text
https://你的域名/admin
```

后台支持：

- 查看用户列表、待处理用户
- 搜索 username / 名字 / 标签
- 查看用户 ID、username、Topic、状态
- 打开 `https://t.me/username` 或 `tg://user?id=...` 联系链接
- 修改备注
- 添加标签
- 管理快捷回复
- 管理关键词自动回复

后台默认使用 Telegram 验证码或密码登录并写入 HttpOnly Cookie 会话；不要使用 URL 明文密码直登。建议只自己使用，并给 `ADMIN_PASSWORD` 设置强密码；正式公开使用时可以再叠加 Cloudflare Access。

### 语音在线播放说明

- Node.js / VPS 部署：如果系统安装了 `ffmpeg`，后台会把 Telegram 语音转成 MP3 并缓存到 `data/audio-cache/`，浏览器兼容性最好。
- Cloudflare Worker / Pages 部署：Worker 不能运行 `ffmpeg`、不能写本地缓存；默认直接代理 Telegram 原始语音文件。若需要同样的 MP3 兼容播放，请配置外部转码服务：

```text
AUDIO_TRANSCODE_URL=https://你的转码服务/audio/transcode
AUDIO_TRANSCODE_SECRET=可选的 Bearer 密钥
```

转码服务约定：接收原始音频 `POST` body，返回 `audio/mpeg` MP3 二进制。

## 后台群命令

在后台群/Topic 里：

```text
/setup              群初始化助手，显示群 ID、管理员 ID、Topics 状态
/help               查看帮助
/id                 查看当前 chat_id 和 thread_id
/info               查看当前用户资料
/contact            查看对方公开 username、t.me 链接、数字 ID
/admin list         查看管理员
/admin add ID 名字   添加管理员
/admin del ID        删除管理员
/users              查看最近用户
/users vip          按关键词/标签筛选用户
/recent             查看最近用户
/pending            查看待处理用户
/broadcast 内容      创建广播草稿
/confirm_broadcast ID 二次确认群发
/check              部署自检
/note 备注内容       给当前用户写备注
/close              关闭当前会话
/open               重新打开当前会话
/quick list         查看快捷回复
/quick hello        发送 hello 快捷回复
/quick set key 内容  新增/更新快捷回复
/welcome 内容        设置用户 /start 欢迎语
/kw list            查看关键词自动回复
/kw set 价格 内容    新增/更新关键词自动回复
/kw del 价格         删除关键词自动回复
/tag vip            给当前用户加标签
/untag vip          移除当前用户标签
/ai                 让 AI 根据上下文生成回复草稿
/ai_on /ai_off      给当前用户开关 AI 自动回复
/ai_auto on/off     全局开关 AI 自动回复，不建议常开
/mute /unmute       静音/恢复该用户提醒
/pin /unpin         标记/取消重要用户
/block              拉黑当前 Topic 对应用户
/unblock            解除拉黑当前 Topic 对应用户
/block 123456789 原因
/unblock 123456789
```

## 使用方式

1. 用户私聊 bot 发送 `/start` 或任意消息。
2. bot 在后台管理群自动创建一个 Topic。
3. 用户后续消息都会进入这个 Topic。
4. 你在这个 Topic 里直接发消息，bot 会复制发送给该用户。

## 安全建议

- 不要公开 `BOT_TOKEN`。
- `WEBHOOK_SECRET` 用长随机字符串。
- 设置 `OWNER_IDS`，避免群里其他成员也能通过 bot 回复用户。
- bot 必须是后台群管理员，否则无法创建 Topic。

## 本地检查

```bash
npm install
npm run typecheck
```
