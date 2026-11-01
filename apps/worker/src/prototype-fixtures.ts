import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pcm16Wave } from '@wanwu-v2/audio-engine/pcm';
import type { RenderInput } from '@wanwu-v2/audio-engine/render';
import { RULE_VERSIONS } from '@wanwu-v2/sound-rules/rules';

export function syntheticWave(seconds = 2, frequency = 440, channels = 1) {
  const samples = Array.from({ length: channels }, (_, channel) =>
    Float32Array.from({ length: Math.round(seconds * 48000) }, (_, i) => {
      const t = i / 48000,
        fade = Math.min(1, t / 0.01, (seconds - t) / 0.02);
      return 0.15 * Math.max(0, fade) * Math.sin(2 * Math.PI * (frequency + channel * 110) * t);
    }),
  );
  return pcm16Wave(samples);
}

export type PrototypeMode = 'short' | 'tail' | 'maximum' | 'example';
const EXAMPLES = ['frog', 'drop', 'leaves'] as const;

export function prototypeInput(mode: PrototypeMode = 'short'): RenderInput {
  const example = mode === 'example',
    count = mode === 'maximum' ? 12 : example ? 3 : 1,
    seconds = mode === 'short' ? 2 : 45;
  const units = Array.from({ length: count }, (_, i) => ({
    version: 'sound-v1' as const,
    id: `unit:${i}`,
    sourceId: `source:${i}`,
    name: example ? ['蛙鸣', '雨滴', '树叶'][i]! : `测试${i + 1}`,
    maker: null,
    markerIndex: i,
    shape:
      mode === 'maximum' && i % 2 === 0
        ? {
            pitch: 'high' as const,
            duration: 'long' as const,
            contour: 'wavy' as const,
            intensity: 'loud' as const,
            pattern: 'bursts' as const,
          }
        : {},
    input: 'manual' as const,
    createdAt: '2026-10-25T00:00:00.000Z',
  }));
  const clips = [
    { startMs: 400, endMs: 3600 },
    { startMs: 3000, endMs: 5800 },
    { startMs: 1000, endMs: 4000 },
  ];
  const events = Array.from({ length: mode === 'maximum' ? 24 : example ? 6 : 1 }, (_, i) => ({
    id: `event:${i}`,
    unitId: units[i % count]!.id,
    at: example ? i / 6 : mode === 'short' ? 0 : mode === 'tail' ? 1 : i / 23,
    row: i % 3,
    clip: example ? clips[i % count]! : { startMs: 0, endMs: seconds * 1000 },
  }));
  return {
    arrangement: {
      version: 'arrangement-v1',
      id: `work:prototype:${mode}`,
      units,
      events,
      rows: 3,
      spanSeconds: mode === 'short' || example ? 20 : 45,
      mood: { kind: 'preset', id: 'calm' },
      origin: 'child',
      updatedAt: '2026-10-25T00:00:00.000Z',
    },
    settings: {
      background: {
        enabled: true,
        instruments:
          mode === 'maximum'
            ? ['inst:local:organ', 'inst:local:xylophone', 'inst:local:drum']
            : example
              ? ['inst:local:xylophone']
              : [],
        volume: 0.5,
      },
      inspiration: { kind: 'none' },
    },
    textbook: null,
    rules: { ...RULE_VERSIONS },
  };
}

/** Synthetic fixtures or existing public derivatives, never private recordings or downloads. */
export async function writePrototypeSources(directory: string, input: RenderInput) {
  if (input.arrangement.id === 'work:prototype:example') {
    const root = new URL('../../../', import.meta.url);
    const manifest = JSON.parse(
      await readFile(new URL('data/catalogue/library-manifest.json', root), 'utf8'),
    ) as { id: string; path: string; sha256: string; bytes: number }[];
    const files = new Map<string, string>();
    for (const [index, id] of EXAMPLES.entries()) {
      const item = manifest.find((entry) => entry.id === id);
      if (!item || !new RegExp(`^data/catalogue/previews/${id}\\.[a-f0-9]+\\.mp3$`).test(item.path))
        throw new Error('missing-published-example');
      const file = fileURLToPath(new URL(item.path, root)),
        bytes = await readFile(file);
      if (
        bytes.length !== item.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== item.sha256
      )
        throw new Error('example-checksum-mismatch');
      files.set(`source:${index}`, file);
    }
    return files;
  }
  await mkdir(directory, { recursive: true });
  const files = new Map<string, string>();
  for (const [index, id] of [
    ...new Set(input.arrangement.units.map((unit) => unit.sourceId)),
  ].entries()) {
    const file = join(directory, `synthetic-${index}.wav`);
    const seconds = input.arrangement.id.endsWith(':short') ? 2 : 45;
    await writeFile(file, syntheticWave(seconds, 220 + index * 37, 2), { flag: 'wx' });
    files.set(id, file);
  }
  return files;
}
