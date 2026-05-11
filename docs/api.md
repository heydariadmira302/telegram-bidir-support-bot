# Admin API

Web 后台和外部管理入口应优先调用 Admin API；Telegram handler 不需要 HTTP 调自己，但必须和 API 共用 service 层。

所有 tenant-scoped API 都支持：

```text
?workspace=<workspaceId>&bot=<botId>
```

未传时兼容旧部署，默认 `workspace=default&bot=default`。

## Admin / Permission

- `GET /admin/api/admins`：列出全局后台管理员，并返回当前 session 权限摘要。
- `POST /admin/api/admin`：添加或更新全局后台管理员。仅 owner 可用。
  - body: `admin_id`/`user_id`, `name`, `role`
- `POST /admin/api/admin`：删除全局后台管理员。仅 owner 可用。
  - body: `delete=true`, `admin_id`/`user_id`

## Workspace / Bot

- `GET /admin/api/workspaces`：列出 workspaces、当前 workspace、当前 workspace 下 bots/admins。
- `POST /admin/api/workspace`：创建或更新 workspace。
  - body: `id`, `name`
- `POST /admin/api/workspace-admin`：添加或更新 workspace 管理员。
  - body: `workspace_id`, `user_id`, `name`, `role`
- `POST /admin/api/workspace-admin`：删除 workspace 管理员。
  - body: `delete=true`, `workspace_id`, `user_id`
- `GET /admin/api/bots`：列出当前 workspace 下 bots。
- `POST /admin/api/bot`：创建、更新或删除 Bot。
  - upsert body: `id`, `name`, `token`, `webhook_secret`, `public_url`, `support_chat_id`, `enabled`, `is_default`
  - delete body: `delete=true`, `id`
  - 如果不传 `support_chat_id`，会生成 `bind_code`，用于 Telegram Forum 群里的 `/bind <code>` 或 `/setup` 绑定流程。
- `POST /admin/api/bot/quick-activate`：新增 Bot 并在可用时自动安装 webhook / setMyCommands。
  - body: `name`, `token`, `public_url`, `support_chat_id`, `is_default`
  - response: `id`, `webhookUrl`, `bindCode`, `bindCommand`, `missingSupportChatId`
  - 非默认 Bot webhook 为 `/telegram/webhook/<botId>`；默认 Bot 为 `/telegram/webhook`。

## Install / System

- `GET /admin/api/install/status`：返回安装/系统检查状态、下一步建议、关键计数。
- `GET /admin/api/system/status`：同上，作为系统状态别名。
- `GET /admin/api/audit-logs`：返回后台操作审计日志。仅 owner 可用，日志 detail 会脱敏保存。
- `GET /admin/api/backup/instructions`：返回 Node.js/Docker 与 Cloudflare D1 的备份指引；不会直接下载数据库。
- `POST /admin/api/install/basic`：应用基础初始化预设，写入欢迎语、关闭提示、限流、默认快捷回复和关键词。仅 owner 可用。
- `POST /admin/api/install/domain`：保存公网访问地址 / 域名。仅 owner 可用。
  - body: `domain` 或 `public_url`
- `POST /admin/api/install/webhook`：使用当前 HTTPS public_url 重新设置 Telegram webhook。仅 owner 可用。
- 兼容别名：`POST /admin/api/domain`、`POST /admin/api/webhook`

## AI Provider / Model

- `GET /admin/api/ai`：列出 AI providers 和 models。
- `GET /admin/api/ai-providers`：列出 AI providers 和 models。
- `GET /admin/api/ai-models`：列出 AI providers 和 models。
- `POST /admin/api/ai-provider`：创建、更新或删除 AI Provider。仅 owner 可用，API Key 加密保存且不回显明文。
  - upsert body: `id`, `name`, `base_url`, `api_key`, `enabled`
  - delete body: `delete=true`, `id`
- `POST /admin/api/ai-provider-models`：从 Provider 的 OpenAI-compatible `/models` 拉取模型列表。仅 owner 可用。
  - body: `provider_id`
- `POST /admin/api/ai-provider-import-model`：从 Provider 添加单个模型配置。仅 owner 可用。
  - body: `provider_id`, `model`, `name`, `is_default`
- `POST /admin/api/ai-provider-import-models`：批量从 Provider 添加模型配置。仅 owner 可用。
  - body: `provider_id`, `models[]`, `is_default`
- `POST /admin/api/ai-model`：创建、更新、启停、设为默认或删除模型。仅 owner 可用。
  - upsert body: `id`, `provider_id`, `name`, `base_url`, `model`, `api_key_env`, `system_prompt`, `enabled`, `is_default`
  - toggle body: `id`, `enabled`
  - default body: `id`, `set_default=true`
  - delete body: `delete=true`, `id`

## Users / Replies / Settings

- `GET /admin/api/users`：当前 bot 下用户、待处理、快捷回复、关键词。
- `GET /admin/api/user?id=<telegramUserId>`：用户详情和消息记录。
- `POST /admin/api/user`：用户操作。
  - body: `user_id`, `action`, `value`
- `GET /admin/api/replies`：快捷回复和关键词。
- `POST /admin/api/quick-replies`：新增/更新/删除快捷回复。
  - upsert body: `key`, `text`
  - delete body: `delete=true`, `key`
- `POST /admin/api/keywords`：新增/更新/启停/删除关键词回复。
  - upsert body: `keyword`, `reply`
  - toggle body: `keyword`, `enabled`
  - delete body: `delete=true`, `keyword`
- `GET /admin/api/settings`：当前 bot settings，带 workspace fallback。
- `POST /admin/api/settings`：更新 setting。
  - body: `key`, `value`

## Broadcast / Support

- `GET /admin/api/broadcasts`：广播草稿/历史和目标统计。
- `POST /admin/api/broadcasts`：创建草稿或确认发送。
  - draft body: `text`, `filter`, `filter_value`
  - confirm body: `confirm=true`, `id`
- `GET /admin/api/workbench`：客服工作台摘要，返回 `summary + stats`。
- `GET /admin/api/workbench/stats`：只返回客服工作台统计。
- `GET /admin/api/user/stats?id=<telegramUserId>`：返回单个用户互动统计；Telegram 资料/统计卡片和 Web/API 复用 service 层实现。
- `GET /admin/api/queue?kind=pending|important|overdue|recent`：客服队列。

## Compatibility aliases

旧路径暂时保留：

- `/admin/api/dashboard`
- `/admin/api/user-action`
- `/admin/api/quick`
- `/admin/api/reply`
- `/admin/api/keyword`
- `/admin/api/setting`
- `/admin/api/broadcast`
