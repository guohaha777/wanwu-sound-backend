import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseArrangement } from '@wanwu-v2/contracts/arrangement';
import { prototypeInput, writePrototypeSources } from '../../src/prototype-fixtures.ts';
import { sha256 } from '../../src/media/normalize.ts';

test('the listening example is a bounded real arrangement, not maximum-fixture tones relabelled as nature sounds', () => {
  const input = prototypeInput('example');
  assert.ok(parseArrangement(input.arrangement));
  assert.equal(input.arrangement.units.length, 3);
  assert.equal(input.arrangement.events.length, 6);
  assert.equal(input.arrangement.spanSeconds, 20);
  assert.deepEqual(
    input.arrangement.units.map((unit) => unit.name),
    ['蛙鸣', '雨滴', '树叶'],
  );
  for (const event of input.arrangement.events) {
    assert.ok(event.clip);
    assert.ok(event.clip.endMs <= 45000);
  }
  assert.deepEqual(input.settings.background.instruments, ['inst:local:xylophone']);
});

test('listening fixtures use only the three checksum-verified, already-public library derivatives', async () => {
  const files = await writePrototypeSources('', prototypeInput('example'));
  const manifest = JSON.parse(
    await readFile(
      new URL('../../../../data/catalogue/library-manifest.json', import.meta.url),
      'utf8',
    ),
  ) as { id: string; sha256: string }[];
  assert.equal(files.size, 3);
  for (const [index, id] of ['frog', 'drop', 'leaves'].entries()) {
    const path = files.get(`source:${index}`);
    assert.ok(path);
    assert.match(path, /data\/catalogue\/previews\//);
    assert.equal(sha256(await readFile(path)), manifest.find((entry) => entry.id === id)!.sha256);
  }
});
