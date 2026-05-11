import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function transcodeToMp3(input: Uint8Array, cacheKey: string): Promise<Uint8Array> {
  const cacheDir = process.env.AUDIO_CACHE_DIR || path.resolve(process.cwd(), 'data', 'audio-cache');
  await mkdir(cacheDir, { recursive: true });
  const hash = createHash('sha256').update(cacheKey).digest('hex').slice(0, 32);
  const outputPath = path.join(cacheDir, `${hash}.mp3`);
  try {
    const cached = await stat(outputPath);
    if (cached.size > 0) return new Uint8Array(await readFile(outputPath));
  } catch {}

  const output = await runFfmpeg(input);
  await writeFile(outputPath, output);
  return output;
}

function runFfmpeg(input: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    const child = spawn(ffmpeg, [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',
      '-acodec', 'libmp3lame',
      '-ar', '44100',
      '-ac', '1',
      '-b:a', '96k',
      '-f', 'mp3',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(new Uint8Array(Buffer.concat(chunks)));
      reject(new Error(`ffmpeg failed (${code}): ${Buffer.concat(errors).toString('utf8').slice(0, 500)}`));
    });
    child.stdin.end(Buffer.from(input));
  });
}
