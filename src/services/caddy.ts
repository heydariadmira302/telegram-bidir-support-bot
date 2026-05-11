import { getSetting } from '../db';
import { normalizePublicUrl } from './domain';
import type { Env } from '../types';

export interface CaddyApplyResult {
  ok: boolean;
  configPath: string;
  domain: string;
  message: string;
}

export async function applyCaddyConfig(env: Env, input: { publicUrl?: string; confirm?: string }): Promise<CaddyApplyResult> {
  if (input.confirm !== 'APPLY_CADDY') throw new Error('请输入 APPLY_CADDY 确认一键配置 Caddy');
  const publicUrl = normalizePublicUrl(input.publicUrl || (await getSetting(env.DB, 'public_url')) || env.PUBLIC_URL || '');
  if (!publicUrl.startsWith('https://')) throw new Error('Caddy 自动证书要求 PUBLIC_URL 使用 https://');
  const domain = new URL(publicUrl).hostname;
  const configPath = '/etc/caddy/Caddyfile';
  const fs = await importNode<typeof import('node:fs/promises')>('node:fs/promises');
  const { execFile } = await importNode<typeof import('node:child_process')>('node:child_process');
  const { promisify } = await importNode<typeof import('node:util')>('node:util');
  const run = promisify(execFile);

  await assertCaddyAvailable(run);
  await fs.mkdir('/etc/caddy', { recursive: true });
  await backupIfExists(fs, configPath);
  await fs.writeFile(configPath, renderManagedCaddyfile(domain), { mode: 0o644 });
  await run('caddy', ['validate', '--config', configPath]);
  await run('systemctl', ['enable', '--now', 'caddy']);
  await run('systemctl', ['reload', 'caddy']);

  return {
    ok: true,
    configPath,
    domain,
    message: `已写入 ${configPath}，Caddy 会为 ${domain} 自动申请和续期 HTTPS 证书。`,
  };
}

async function assertCaddyAvailable(run: (file: string, args?: readonly string[]) => Promise<unknown>): Promise<void> {
  try {
    await run('caddy', ['version']);
  } catch {
    throw new Error('服务器未安装 Caddy。请先安装 Caddy 后再执行一键配置。Debian/Ubuntu 可参考官方安装命令，或手动安装后重试。');
  }
}

async function backupIfExists(fs: typeof import('node:fs/promises'), file: string): Promise<void> {
  try {
    await fs.access(file);
  } catch {
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.copyFile(file, `${file}.bak.${stamp}`);
}

function renderManagedCaddyfile(domain: string): string {
  return `# Managed by telegram-bidir-support-bot\n# Existing file is backed up before overwrite.\n${domain} {\n  encode gzip zstd\n\n  reverse_proxy 127.0.0.1:3000 {\n    header_up Host {host}\n    header_up X-Real-IP {remote_host}\n    header_up X-Forwarded-For {remote_host}\n    header_up X-Forwarded-Proto {scheme}\n  }\n}\n`;
}

async function importNode<T>(specifier: string): Promise<T> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<T>;
  return dynamicImport(specifier);
}
