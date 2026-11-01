import test from 'node:test';
import assert from 'node:assert/strict';
import {
  releaseManifest,
  releaseEnvironment,
  environmentPins,
  imageKinds,
  acceptsImage,
} from '../../../../deploy/runtime/image-pins.ts';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('release pins accept only verified modern image or classic config digests, never mutable tags or mismatched source', () => {
  const manifest = releaseManifest({
    project: 'wanwu-sound',
    sourceDigest: 'a'.repeat(64),
    images: Object.fromEntries(
      imageKinds.map((kind, i) => [
        kind,
        {
          tag: `wanwu-${kind}:${'b'.repeat(12)}-${'c'.repeat(12)}`,
          id: `sha256:${String(i + 1).repeat(64)}`,
          configDigest: `sha256:${String(i + 5).repeat(64)}`,
        },
      ]),
    ),
  });
  const modern = Object.fromEntries(
    imageKinds.map((kind) => [kind, manifest.images[kind].id]),
  ) as Record<(typeof imageKinds)[number], string>;
  const classic = Object.fromEntries(
    imageKinds.map((kind) => [kind, manifest.images[kind].configDigest]),
  ) as typeof modern;
  for (const ids of [modern, classic])
    assert.deepEqual(environmentPins(releaseEnvironment(manifest, ids), manifest), ids);
  assert.equal(acceptsImage(manifest.images.api, 'wanwu-api:latest'), false);
  assert.throws(() => releaseEnvironment(manifest, { ...modern, api: `sha256:${'f'.repeat(64)}` }));
  assert.throws(() =>
    environmentPins(
      releaseEnvironment(manifest, modern).replace(
        `WANWU_SOURCE_DIGEST=${'a'.repeat(64)}`,
        `WANWU_SOURCE_DIGEST=${'d'.repeat(64)}`,
      ),
      manifest,
    ),
  );
  assert.throws(() =>
    environmentPins(releaseEnvironment(manifest, modern) + 'WANWU_API_IMAGE=ignored\n', manifest),
  );
  assert.throws(() =>
    releaseManifest({ ...manifest, images: { ...manifest.images, legacy: manifest.images.api } }),
  );
  assert.throws(() =>
    releaseManifest({
      ...manifest,
      images: { ...manifest.images, api: { ...manifest.images.api, tag: 'old-project:latest' } },
    }),
  );
});

test('restore CLI rejects malformed and production database URLs without printing connection secrets', () => {
  const file = fileURLToPath(new URL('../../src/maintenance/restore-cli.ts', import.meta.url)),
    secret = 'do-not-print-this-restore-probe';
  for (const url of [secret, `postgresql://wanwu_owner:${secret}@127.0.0.1:1/wanwu_sound`]) {
    const result = spawnSync(process.execPath, [file], {
      encoding: 'utf8',
      timeout: 8000,
      env: { ...process.env, WANWU_RESTORE_DATABASE_URL: url },
    });
    assert.equal(result.status, 1);
    assert.equal((result.stdout + result.stderr).includes(secret), false);
    assert.match(result.stderr, /Isolated restore failed/);
  }
});
