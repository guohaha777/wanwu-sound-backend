import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWork } from '@wanwu-v2/audio-engine/render';
import { prototypeInput } from '../../src/prototype-fixtures.ts';

const noSource = async () => {
  throw new Error('must-not-load-source');
};
test('reject unknown versions, fake instruments, empty works and postponed AI before loading files', async () => {
  const input = prototypeInput();
  await assert.rejects(
    renderWork({ ...input, rules: { ...input.rules, mix: 'other' } }, noSource),
    /renderer-incompatible/,
  );
  await assert.rejects(
    renderWork({ ...input, arrangement: { ...input.arrangement, events: [] } }, noSource),
    /empty-work/,
  );
  await assert.rejects(
    renderWork(
      {
        ...input,
        settings: {
          ...input.settings,
          background: { enabled: true, volume: 0.5, instruments: ['fake'] },
        },
      },
      noSource,
    ),
    /unknown-instrument/,
  );
  await assert.rejects(
    renderWork(
      {
        ...input,
        settings: {
          ...input.settings,
          inspiration: {
            kind: 'teaching-music',
            musicId: 'fake',
            name: '未开放',
            durationMs: 1000,
          },
        },
      },
      noSource,
    ),
    /not-open/,
  );
});
