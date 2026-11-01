import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  encryptBackup,
  decryptBackup,
  backupChecksum,
} from '../../src/maintenance/backupCrypto.ts';

test('backup envelope round-trips actual bytes, authenticates the header/ciphertext and never overwrites a target', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const directory = await mkdtemp(join(tmpdir(), 'wanwu-backup-test-'));
  try {
    const bytes = randomBytes(1024 * 1024 + 41),
      encrypted = join(directory, 'database.wwb'),
      restored = join(directory, 'restored.dump');
    const result = await encryptBackup(Readable.from([bytes]), encrypted, publicKey);
    assert.equal(result.bytes, (await stat(encrypted)).size);
    assert.equal(result.checksum, await backupChecksum(encrypted));
    assert.equal((await readFile(encrypted)).includes(bytes.subarray(0, 64)), false);
    assert.equal((await stat(encrypted)).mode & 0o777, 0o600);
    await decryptBackup(encrypted, restored, privateKey);
    assert.deepEqual(await readFile(restored), bytes);
    await assert.rejects(() => decryptBackup(encrypted, restored, privateKey));
    assert.deepEqual(await readFile(restored), bytes);
    const corrupt = await readFile(encrypted);
    corrupt[corrupt.length - 32]! ^= 1;
    const tampered = join(directory, 'tampered.wwb'),
      partial = join(directory, 'partial.dump');
    await writeFile(tampered, corrupt);
    await assert.rejects(() => decryptBackup(tampered, partial, privateKey));
    await assert.rejects(() => stat(partial));
    await assert.rejects(
      () => encryptBackup(Readable.from([bytes]), join(directory, 'private.wwb'), privateKey),
      /only-have-public-key/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
