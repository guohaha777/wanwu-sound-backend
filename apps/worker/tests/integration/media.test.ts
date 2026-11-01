import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { developmentTools } from '../../src/devTools.ts';
import { normalizeSource, encodeMp3, sha256 } from '../../src/media/normalize.ts';
import { runMediaTool } from '../../src/media/tools.ts';
import { syntheticWave } from '../../src/prototype-fixtures.ts';

test(
  'actual WebM, M4A, OGG, MP3 and WAV decode to canonical PCM without changing originals',
  { timeout: 120_000 },
  async () => {
    const tools = await developmentTools(),
      directory = await mkdtemp(join(tmpdir(), 'wanwu-formats-'));
    try {
      const original = join(directory, 'tone.wav');
      await writeFile(original, syntheticWave(1, 440, 2));
      const formats = [
        ['webm', 'libopus'],
        ['m4a', 'aac'],
        ['ogg', 'libvorbis'],
        ['mp3', 'libmp3lame'],
        ['wav', 'pcm_s16le'],
      ];
      for (const [extension, codec] of formats) {
        const file = join(directory, `fixture.${extension}`);
        await runMediaTool(tools.ffmpeg, [
          '-nostdin',
          '-v',
          'error',
          '-n',
          '-threads',
          '1',
          '-i',
          original,
          '-threads',
          '1',
          '-c:a',
          codec!,
          file,
        ]);
        const before = sha256(await readFile(file));
        const normalized = await normalizeSource(file, directory, tools, before);
        assert.equal(normalized.channels, 2);
        assert.ok(normalized.durationMs > 900 && normalized.durationMs < 1100, extension);
        assert.equal(normalized.sourceChecksum, before);
        assert.equal(sha256(await readFile(file)), before);
        await normalized.dispose();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'actual bytes defeat false extensions, corrupted media, checksum mismatch and the duration limit',
  { timeout: 120_000 },
  async () => {
    const tools = await developmentTools(),
      directory = await mkdtemp(join(tmpdir(), 'wanwu-invalid-'));
    try {
      const fake = join(directory, 'fake.mp3');
      await writeFile(fake, 'not audio');
      await assert.rejects(normalizeSource(fake, directory, tools), /invalid-media/);
      const renamed = join(directory, 'valid.audio-claim');
      await writeFile(renamed, syntheticWave());
      await assert.rejects(
        normalizeSource(renamed, directory, tools, '0'.repeat(64)),
        /checksum-mismatch/,
      );
      const accepted = await normalizeSource(renamed, directory, tools);
      await accepted.dispose();
      const excessive = join(directory, 'long.wav');
      await writeFile(excessive, syntheticWave(45.6));
      await assert.rejects(normalizeSource(excessive, directory, tools), /too-long/);
      const boundary = join(directory, 'boundary.wav');
      await writeFile(boundary, syntheticWave(45.5));
      const edge = await normalizeSource(boundary, directory, tools);
      assert.equal(edge.durationMs, 45500);
      await edge.dispose();
      const oversized = join(directory, 'oversized.wav');
      await writeFile(oversized, new Uint8Array(20 * 1024 * 1024 + 1));
      await assert.rejects(normalizeSource(oversized, directory, tools), /too-large/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'MP3 encoding is real, 48 kHz/stereo, and refuses to overwrite an existing output',
  { timeout: 60_000 },
  async () => {
    const tools = await developmentTools(),
      directory = await mkdtemp(join(tmpdir(), 'wanwu-mp3-'));
    try {
      const wave = join(directory, 'source.wav'),
        mp3 = join(directory, 'result.mp3');
      await writeFile(wave, syntheticWave());
      const probe = await encodeMp3(wave, mp3, tools);
      assert.equal(probe.codec, 'mp3');
      assert.equal(probe.sampleRate, 48000);
      assert.equal(probe.channels, 2);
      assert.ok((await stat(mp3)).size > 10000);
      const checksum = sha256(await readFile(mp3));
      await assert.rejects(encodeMp3(wave, mp3, tools), /output-exists/);
      assert.equal(sha256(await readFile(mp3)), checksum);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
