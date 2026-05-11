import { html } from './telegram';
import { topicUrl, type SupportQueueKind, type SupportQueuePanel, type SupportWorkbenchSummary, type WorkbenchStats } from './service';
import type { Env, UserRow } from './types';

export type WorkbenchAction = 'home' | 'pending' | 'important' | 'overdue' | 'recent' | 'refresh';

export function parseWorkbenchCallback(data?: string): WorkbenchAction | null {
  if (!data) return null;
  const match = /^w:(home|pending|important|overdue|recent|refresh)$/.exec(data);
  return match ? (match[1] as WorkbenchAction) : null;
}

export function queueKindFromAction(action: WorkbenchAction): SupportQueueKind | null {
  if (action === 'pending' || action === 'important' || action === 'overdue' || action === 'recent') return action;
  return null;
}

export function workbenchText(summary: SupportWorkbenchSummary, stats?: WorkbenchStats): string {
  const lines = [
    '📌 <b>客服工作台</b>',
    '',
  ];
  if (stats) {
    lines.push(
      '📊 <b>今日概览</b>',
      `今日咨询：<b>${stats.todayUsers}</b> 人 · 新客户：<b>${stats.todayNewUsers}</b> 人`,
      `客户消息：<b>${stats.todayInboundMessages}</b> 条 · 客服回复：<b>${stats.todayOutboundMessages}</b> 条`,
      `等待客户：<b>${stats.waitingUsers}</b> 人 · 最长等待：<b>${html(formatDuration(stats.longestWaitingSeconds))}</b>`,
      `最近 7 天：<b>${stats.weekUsers}</b> 人 / <b>${stats.weekMessages}</b> 条消息 · 新客户 <b>${stats.weekNewUsers}</b>`,
      '',
    );
  }
  lines.push(
    '🧭 <b>队列</b>',
    `🕘 待跟进：<b>${summary.pending}</b>`,
    `⭐ 重要：<b>${summary.important}</b>`,
    `⏳ 超过 30 分钟未处理：<b>${summary.overdue}</b>`,
    `🧾 最近用户：<b>${summary.recent}</b>`,
    '',
    '先看队列，再进 Topic 处理；不要靠翻聊天记录找人。',
  );
  return lines.join('\n');
}

function formatDuration(seconds: number): string {
  if (!seconds) return '0 分钟';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

export function workbenchKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🕘 待处理', callback_data: 'w:pending' },
        { text: '⭐ 重要', callback_data: 'w:important' },
      ],
      [
        { text: '⏳ 超时', callback_data: 'w:overdue' },
        { text: '🧾 最近', callback_data: 'w:recent' },
      ],
      [{ text: '🔄 刷新', callback_data: 'w:refresh' }],
    ],
  };
}

export function queueText(env: Env, panel: SupportQueuePanel): string {
  const titles: Record<SupportQueueKind, string> = {
    pending: '🕘 待处理队列',
    important: '⭐ 重要用户',
    overdue: '⏳ 超时未处理',
    recent: '🧾 最近用户',
  };

  const lines = [
    `<b>${titles[panel.kind]}</b>`,
    `待处理 ${panel.summary.pending} · 重要 ${panel.summary.important} · 超时 ${panel.summary.overdue}`,
    '',
  ];

  if (!panel.users.length) {
    lines.push('暂无。');
  } else {
    panel.users.forEach((row, index) => lines.push(formatQueueUser(env, row, index + 1)));
  }

  return lines.join('\n');
}

export function queueKeyboard(env: Env, panel: SupportQueuePanel) {
  const rows = panel.users.slice(0, 8).map((row, index) => {
    const url = topicUrl(env, row);
    const text = `打开 ${index + 1}`;
    return url
      ? [{ text, url }]
      : [{ text: `👤 ${text}`, callback_data: `u:${row.user_chat_id}:info` }];
  });

  return {
    inline_keyboard: [
      ...rows,
      [
        { text: '↩️ 工作台', callback_data: 'w:home' },
        { text: '🔄 刷新', callback_data: `w:${panel.kind}` },
      ],
    ],
  };
}

function formatQueueUser(env: Env, row: UserRow, index: number): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.username || row.user_chat_id;
  const flags = [row.pending ? '待处理' : '已处理', row.important ? '⭐' : '', row.status === 'closed' ? '已关闭' : ''].filter(Boolean).join(' / ');
  const url = topicUrl(env, row);
  const link = url ? `<a href="${html(url)}">打开 Topic</a>` : '无 Topic 链接';
  return [
    `${index}. <b>${html(name)}</b>${row.username ? ` @${html(row.username)}` : ''}`,
    `   ID: <code>${html(row.user_chat_id)}</code> · ${html(flags || '普通')}`,
    `   标签: ${html(row.tags || '无')} · ${link}`,
  ].join('\n');
}
