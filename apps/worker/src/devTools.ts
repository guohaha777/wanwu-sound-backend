import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
import type { MediaTools } from './media/tools.ts';

/** Prototype-only fallback. Production images use their own installed FFmpeg/ffprobe, not npm binaries. */
export async function developmentTools(): Promise<MediaTools> {
  if (process.env.WANWU_CONTAINER_TEST === '1') return { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
  const require = createRequire(import.meta.url);
  const ffmpeg = process.env.FFMPEG_PATH ?? (require('ffmpeg-static') as string);
  const ffprobe = process.env.FFPROBE_PATH ?? (require('ffprobe-static') as { path: string }).path;
  if (!ffmpeg || !ffprobe) throw new Error('media-tool-unavailable');
  try {
    await Promise.all([access(ffmpeg), access(ffprobe)]);
  } catch {
    throw new Error(
      'media-tool-unavailable: install the reviewed project-local binaries, or set FFMPEG_PATH / FFPROBE_PATH',
    );
  }
  return { ffmpeg, ffprobe };
}
