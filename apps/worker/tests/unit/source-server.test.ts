import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceServer } from '../../src/browser/source-server.ts';
import type { NormalizedSource } from '../../src/media/normalize.ts';

test('loopback transport streams only the supplied source map, with no-store and a nonce CSP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wanwu-transport-'));
  const file = join(directory, 'source.wav'),
    bytes = Buffer.alloc(256 * 1024, 42);
  await writeFile(file, bytes);
  const source: NormalizedSource = {
    path: file,
    sourceChecksum: 'test',
    normalizedChecksum: 'test',
    bytes: bytes.length,
    durationMs: 1000,
    channels: 1,
    dispose: async () => {},
  };
  const transport = await sourceServer('window.testValue=1;', new Map([['source:test', source]]));
  try {
    assert.match(transport.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const page = await fetch(transport.origin);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const csp = page.headers.get('content-security-policy')!;
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /connect-src 'self'/);
    assert.match(await page.text(), /<script nonce="[A-Za-z0-9_-]+">window\.testValue=1;/);
    const response = await fetch(transport.origin + '/sources/source%3Atest');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/wav');
    assert.equal(response.headers.get('content-length'), String(bytes.length));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    for (const path of [
      '/sources/unknown',
      '/sources/../../etc/passwd',
      '/sources/source%3Atest?url=file',
      '/etc/passwd',
    ]) {
      const denied = await fetch(transport.origin + path);
      assert.equal(denied.status, 404, path);
    }
    assert.equal((await fetch(transport.origin + '/sources/%zz')).status, 400);
    assert.equal((await fetch(transport.origin, { method: 'POST', body: 'no' })).status, 405);
  } finally {
    await transport.close();
    await rm(directory, { recursive: true, force: true });
  }
  await assert.rejects(fetch(transport.origin));
});
