export interface Env {
  BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
  SUPPORT_CHAT_ID: string;
  PUBLIC_URL?: string;
  WORKSPACE_ID?: string;
  BOT_ID?: string;
  OWNER_IDS?: string;
  BOT_USERNAME?: string;
  DEFAULT_LANG?: string;
  RATE_LIMIT_COUNT?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
  SUPPORT_CARD_FALLBACK?: string;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_SYSTEM_PROMPT?: string;
  AI_AUTO_REPLY?: string;
  ADMIN_PASSWORD?: string;
  ENCRYPTION_SECRET?: string;
  KB_ENABLED?: string;
  DB: D1Database;
  KV?: KVNamespace;
  TELEGRAM_API_BASE?: string;
  AUDIO_TRANSCODE_URL?: string;
  AUDIO_TRANSCODE_SECRET?: string;
}

export interface RuntimeAdapters {
  transcodeAudioToMp3?: (input: Uint8Array, cacheKey: string, meta?: { mediaType?: string | null; mimeType?: string | null }) => Promise<Uint8Array>;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: boolean;
}

export interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  chat: TelegramChat;
  date?: number;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
  forward_origin?: unknown;
  photo?: unknown[];
  document?: unknown;
  video?: unknown;
  animation?: unknown;
  audio?: TelegramFileMessage | unknown;
  voice?: TelegramFileMessage | unknown;
  video_note?: unknown;
  sticker?: unknown;
  contact?: unknown;
  location?: unknown;
  venue?: unknown;
}

export interface TelegramFileMessage {
  file_id?: string;
  file_unique_id?: string;
  duration?: number;
  mime_type?: string;
  file_name?: string;
  file_size?: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  inline_message_id?: string;
  chat_instance?: string;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TgResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface MessageLogRow {
  id?: number;
  direction: string;
  text: string | null;
  created_at: string;
  message_id?: number | null;
  media_type?: string | null;
  file_id?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  duration?: number | null;
}

export interface UserRow {
  workspace_id?: string;
  bot_id?: string;
  user_chat_id: string;
  topic_id: number | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  language_code: string | null;
  is_blocked: number;
  note: string | null;
  status?: string | null;
  muted?: number | null;
  important?: number | null;
  closed_at?: string | null;
  tags?: string | null;
  ai_mode?: string | null;
  pending?: number | null;
  last_message_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface QuickReplyRow {
  workspace_id?: string;
  bot_id?: string;
  key: string;
  text: string;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export interface WorkspaceAdminRow {
  workspace_id: string;
  user_id: string;
  name: string | null;
  role: AdminRole;
  created_at?: string;
  updated_at?: string;
}

export interface BotRow {
  id: string;
  workspace_id: string;
  name: string;
  token_encrypted: string | null;
  token_hint: string | null;
  webhook_secret: string | null;
  public_url: string | null;
  support_chat_id: string | null;
  bind_code: string | null;
  bind_code_expires_at: string | null;
  enabled: number;
  is_default: number;
  created_at?: string;
  updated_at?: string;
}

export interface BotConfig extends BotRow {
  token?: string;
}

export interface TenantContext {
  workspaceId: string;
  botId: string;
  bot: BotConfig;
}

export interface SettingRow {
  key: string;
  value: string;
}

export interface KeywordReplyRow {
  workspace_id?: string;
  bot_id?: string;
  keyword: string;
  reply: string;
  match_mode: string;
  enabled: number;
}

export type BroadcastFilterType = 'all' | 'tag' | 'pending' | 'important' | 'active_days';

export interface BroadcastTargetFilter {
  type: BroadcastFilterType;
  value?: string;
}

export interface BroadcastResultRow {
  broadcast_id: string;
  user_chat_id: string;
  status: 'ok' | 'failed';
  error: string | null;
  sent_at: string;
}

export interface BroadcastRow {
  id: string;
  text: string;
  created_by: string | null;
  status: string;
  created_at: string;
  sent_at?: string | null;
  target_filter: string | null;
  target_count: number | null;
  ok_count: number | null;
  failed_count: number | null;
}

export interface AiProviderRow {
  id: string;
  name: string;
  base_url: string;
  api_key_encrypted: string | null;
  api_key_hint: string | null;
  enabled: number;
  created_at?: string;
  updated_at?: string;
}

export interface AiModelRow {
  id: string;
  provider_id: string | null;
  name: string;
  base_url: string;
  model: string;
  api_key_env: string;
  system_prompt: string | null;
  enabled: number;
  is_default: number;
  created_at?: string;
  updated_at?: string;
}

export interface KbRawMessageRow {
  id: number;
  batch_id: string;
  source: string;
  chat_title: string | null;
  message_id: string | null;
  sender_name: string | null;
  message_date: string | null;
  text: string;
  tags: string | null;
  created_at: string;
}

export interface KbEntryRow {
  id: string;
  title: string;
  content: string;
  tags: string | null;
  source: string | null;
  confidence: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export type AdminRole = 'owner' | 'admin' | 'readonly';

export interface AdminRow {
  workspace_id?: string;
  bot_id?: string | null;
  user_id: string;
  name: string | null;
  role: AdminRole;
  created_at?: string;
}

export interface AdminSession {
  role: AdminRole;
  actor: string;
  isOwner: boolean;
  canWrite: boolean;
}

export interface AuditLogRow {
  id: number;
  actor: string | null;
  ip: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  status: string;
  created_at: string;
}
