import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA, checkShared } from '../scripts/check-shared.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = (text) => createHash('sha256').update(text).digest('hex');

test('the shared packages in this repository match their committed fingerprints', async () => {
  const result = await checkShared(root);
  assert.ok(result.files > 20);
  assert.deepEqual(
    {
      changed: result.changed,
      missing: result.missing,
      extra: result.extra,
      symlinks: result.symlinks,
    },
    { changed: [], missing: [], extra: [], symlinks: [] },
  );
});

test('a changed, missing, extra or symlinked shared file is reported', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wanwu-shared-'));
  try {
    await mkdir(path.join(dir, 'handoff'));
    await mkdir(path.join(dir, 'packages/contracts/src'), { recursive: true });
    const sharedFiles = [
      { path: 'packages/contracts/src/kept.ts', sha256: digest('kept') },
      { path: 'packages/contracts/src/edited.ts', sha256: digest('original') },
      { path: 'packages/contracts/src/gone.ts', sha256: digest('gone') },
    ];
    await writeFile(
      path.join(dir, 'handoff/manifest.json'),
      JSON.stringify({ schema: SCHEMA, sharedFiles }),
    );
    await writeFile(path.join(dir, 'packages/contracts/src/kept.ts'), 'kept');
    await writeFile(path.join(dir, 'packages/contracts/src/edited.ts'), 'edited here only');
    await writeFile(path.join(dir, 'packages/contracts/src/new.ts'), 'not synced');
    await symlink(tmpdir(), path.join(dir, 'packages/contracts/linked'));
    const result = await checkShared(dir);
    assert.deepEqual(result.changed, ['packages/contracts/src/edited.ts']);
    assert.deepEqual(result.missing, ['packages/contracts/src/gone.ts']);
    assert.deepEqual(result.extra, ['packages/contracts/src/new.ts']);
    assert.deepEqual(result.symlinks, ['packages/contracts/linked']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('manifest paths outside the shared packages are refused', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wanwu-shared-'));
  try {
    await mkdir(path.join(dir, 'handoff'));
    for (const bad of [
      'apps/api/src/app.ts',
      'packages/contracts/../../.env',
      'packages\\contracts\\x.ts',
      'packages/other/x.ts',
    ]) {
      await writeFile(
        path.join(dir, 'handoff/manifest.json'),
        JSON.stringify({ schema: SCHEMA, sharedFiles: [{ path: bad, sha256: digest('x') }] }),
      );
      await assert.rejects(checkShared(dir), /Invalid manifest entry/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
