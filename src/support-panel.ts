import { html } from './telegram';
import type { UserRow } from './types';

export type SupportPanelAction =
  | 'info'
  | 'contact'
  | 'stats'
  | 'done'
  | 'pending'
  | 'close'
  | 'open'
  | 'pin'
  | 'unpin'
  | 'mute'
  | 'unmute'
  | 'block'
  | 'block_ok'
  | 'unblock';

export interface SupportPanelCallback {
  userId: string;
  action: SupportPanelAction;
}

export function parseSupportPanelCallback(data?: string): SupportPanelCallback | null {
  if (!data) return null;
  const match = /^u:(-?\d+):(info|contact|stats|done|pending|close|open|pin|unpin|mute|unmute|block|block_ok|unblock)$/.exec(data);
  if (!match) return null;
  return { userId: match[1], action: match[2] as SupportPanelAction };
}

export function isReadOnlySupportPanelAction(action: SupportPanelAction): boolean {
  return action === 'info' || action === 'contact' || action === 'stats';
}

export type SupportPanelMode = 'normal' | 'contact' | 'confirm_block';

export function supportUserCard(row: UserRow, mode: SupportPanelMode = 'normal', options: { pendingTracking?: boolean } = {}): string {
  if (mode === 'contact') return supportContactCard(row);

  const nickname = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.username || row.user_chat_id;
  const flags = [
    options.pendingTracking === false ? '' : row.pending ? '待处理' : '已处理',
    row.status === 'closed' ? '已关闭' : '会话中',
    row.is_blocked ? '已拉黑' : '',
    row.important ? '重要' : '',
    row.muted ? '静音' : '',
  ].filter(Boolean).join(' · ');

  return [
    '👤 <b>用户资料</b>',
    '',
    `昵称：<b>${html(nickname)}</b>`,
    `用户名：${row.username ? `@${html(row.username)}` : '无'}`,
    `用户 ID：<code>${html(row.user_chat_id)}</code>`,
    `语言：${html(row.language_code || '未知')}`,
    '',
    `状态：<b>${html(flags)}</b>`,
    `标签：${html(row.tags || '无')}`,
    `备注：${html(row.note || '无')}`,
    `Topic：<code>${html(row.topic_id ?? '')}</code>`,
    '',
    '💬 直接在本 Topic 回复，消息会自动转发给用户。',
  ].join('\n');
}

export function supportUserPanel(row: UserRow, mode: SupportPanelMode = 'normal', options: { pendingTracking?: boolean } = {}) {
  const userId = row.user_chat_id;
  if (mode === 'confirm_block') {
    return {
      inline_keyboard: [
        [{ text: '⚠️ 确认拉黑', callback_data: cb(userId, 'block_ok') }],
        [{ text: '↩️ 返回面板', callback_data: cb(userId, 'info') }],
      ],
    };
  }

  if (mode === 'contact') {
    return {
      inline_keyboard: [
        [{ text: '↩️ 返回资料', callback_data: cb(userId, 'info') }],
      ],
    };
  }

  const isClosed = row.status === 'closed';
  const isPending = Boolean(row.pending);
  const isImportant = Boolean(row.important);
  const isMuted = Boolean(row.muted);
  const isBlocked = Boolean(row.is_blocked);

  return {
    inline_keyboard: [
      [
        { text: '👤 资料', callback_data: cb(userId, 'info') },
        { text: '🔗 联系', callback_data: cb(userId, 'contact') },
      ],
      ...(options.pendingTracking === false ? [] : [[
        { text: isPending ? '✅ 已处理' : '🕘 待跟进', callback_data: cb(userId, isPending ? 'done' : 'pending') },
      ]]),
      [
        { text: isImportant ? '☆ 取消重要' : '⭐ 重要', callback_data: cb(userId, isImportant ? 'unpin' : 'pin') },
        { text: isMuted ? '🔔 取消静音' : '🔕 静音', callback_data: cb(userId, isMuted ? 'unmute' : 'mute') },
      ],
      [
        { text: isBlocked ? '✅ 解除拉黑' : '⛔ 拉黑', callback_data: cb(userId, isBlocked ? 'unblock' : 'block') },
      ],
    ],
  };
}

export function supportMessageQuickPanel(row: UserRow, options: { pendingTracking?: boolean } = {}) {
  const userId = row.user_chat_id;
  const isPending = Boolean(row.pending);
  const isBlocked = Boolean(row.is_blocked);
  return {
    inline_keyboard: [
      [
        { text: '👤 用户资料', callback_data: cb(userId, 'info') },
        { text: '📊 互动统计', callback_data: cb(userId, 'stats') },
      ],
      [
        ...(options.pendingTracking === false ? [] : [{ text: isPending ? '✅ 已处理' : '🕘 待跟进', callback_data: cb(userId, isPending ? 'done' : 'pending') }]),
        { text: isBlocked ? '✅ 解除拉黑' : '⛔ 拉黑', callback_data: cb(userId, isBlocked ? 'unblock' : 'block') },
      ],
    ],
  };
}

function supportContactCard(row: UserRow): string {
  const username = row.username ? `@${row.username}` : '无公开 username';
  const tgLink = row.username ? `https://t.me/${row.username}` : `tg://user?id=${row.user_chat_id}`;
  return [
    '🔗 <b>联系信息</b>',
    '',
    `用户 ID：<code>${html(row.user_chat_id)}</code>`,
    `公开用户名：${html(username)}`,
    `打开链接：${html(tgLink)}`,
    '',
    '说明：Bot 只能读取公开 username、姓名和数字 ID。对方没设置 username 时，不能通过 Bot 强行获取手机号。',
  ].join('\n');
}

function cb(userId: string, action: SupportPanelAction): string {
  return `u:${userId}:${action}`;
}

function formatStatus(row: UserRow): string {
  const parts = [row.status || 'open'];
  if (row.pending) parts.push('待处理');
  if (row.is_blocked) parts.push('已拉黑');
  if (row.important) parts.push('重要');
  if (row.muted) parts.push('静音');
  return parts.join(' / ');
}
