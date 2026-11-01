import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEXTBOOK_COMPOSE_VERSION,
  isTextbookComposeInput,
} from '@wanwu-v2/contracts/textbook-compose';
import type { TextbookComposeInput, TextbookSound } from '@wanwu-v2/contracts/textbook-compose';
import type { TextbookTrack } from '@wanwu-v2/contracts/textbook';
// Self-contained synthetic fixtures: shared tests must also run in the backend repository.
const base: TextbookTrack = {
  version: 'textbook-v1',
  id: 'test:two',
  title: '测试二拍',
  source: null,
  tempoBpm: 96,
  meter: 2,
  rhythmCell: [0.5, 0.5, 0.5, 0.25, 0.25],
  onsetDensity: 'medium',
  pitchRange: { low: 59, high: 84 },
  brightness: 'mid',
  mode: 'major',
  tonic: 0,
  repetition: 'medium',
  mood: 'lively',
  childLine: '测试用',
  extraction: { numbers: 'example', words: 'example', confidence: 0.7, earChecked: false },
};
const textbookTracks = [
  base,
  {
    ...base,
    id: 'test:three',
    tempoBpm: 136,
    meter: 3 as const,
    rhythmCell: [0.75, 0.25, 1, 1],
    tonic: 5,
  },
];
import {
  composeTextbook,
  TEXTBOOK_RULES,
  TEXTBOOK_TAKES,
  textbookPortrait,
  textbookRuleProblems,
} from '../src/textbookCompose.ts';
import { BACKGROUND_RULES } from '../src/rules.ts';
const sound = (extra: Partial<TextbookSound> = {}): TextbookSound => ({
  n: 1,
  eventId: 'e1',
  start: 1,
  end: 1.5,
  pitch: 'high',
  length: 'short',
  contour: 'rising',
  intensity: 'medium',
  pattern: 'once',
  kind: 'one',
  brightness: 'bright',
  sources: {
    pitch: 'child',
    length: 'child',
    contour: 'child',
    intensity: 'child',
    pattern: 'child',
    kind: 'measurement',
    brightness: 'measurement',
  },
  ...extra,
});
const input = (extra: Partial<TextbookComposeInput> = {}): TextbookComposeInput => ({
  version: TEXTBOOK_COMPOSE_VERSION,
  seconds: 20,
  mood: null,
  textbook: textbookTracks[0]!,
  sounds: [sound()],
  ...extra,
});
const ready = (v: TextbookComposeInput) => {
  const r = composeTextbook(v);
  assert.equal(r.status, 'ready');
  if (r.status !== 'ready') throw new Error('not-ready');
  return r;
};

test('textbook input rejects malformed timing, features and sources without entering generation', () => {
  assert.ok(isTextbookComposeInput(input()));
  for (const sounds of [
    [sound({ end: NaN })],
    [sound({ end: 21 })],
    [sound(), sound()],
    [sound({ start: -1 })],
    [sound({ sources: { pitch: 'invented' as 'child' } })],
  ])
    assert.deepEqual(composeTextbook(input({ sounds })), {
      status: 'unavailable',
      reason: 'invalid-input',
    });
  assert.deepEqual(textbookRuleProblems(TEXTBOOK_RULES), []);
  const broken = structuredClone(TEXTBOOK_RULES);
  broken.answer.shortBeats = 0;
  assert.throws(() => composeTextbook(input(), broken), /invalid-textbook-rules/);
});

test('136 BPM and three beats remain locked under every child mood, with the song tonic preserved', () => {
  for (const mood of [
    null,
    'happy',
    'sad',
    'calm',
    'angry',
    'curious',
    'scared',
    'lively',
  ] as const) {
    const r = ready(input({ mood, textbook: textbookTracks[1]! }));
    assert.equal(r.music.tempo, 136);
    assert.equal(r.music.metre, 3);
    assert.equal(r.music.tonic % 12, 5);
  }
  assert.equal(ready(input({ mood: 'sad' })).music.mode, 'minor');
  assert.equal(ready(input()).music.mode, textbookTracks[0]!.mode);
});

test('coverage and overlap account for long sounds across later bars and do not invent new starts', () => {
  const r = textbookPortrait(
    input({
      sounds: [sound({ start: 0, end: 14 }), sound({ eventId: 'e2', n: 2, start: 2, end: 12 })],
    }),
  );
  const later = r.bars.find((b) => b.start > 4 && b.end < 12)!;
  assert.equal(later.coverage, 1);
  assert.equal(later.overlap, 1);
  assert.equal(later.maxConcurrent, 2);
  assert.equal(later.onsets, 0);
  assert.equal(later.density, 'busy');
});

test('touching sounds are not overlapping; partial final bar keeps exact coverage', () => {
  const r = textbookPortrait(
    input({
      seconds: 3,
      sounds: [sound({ start: 0, end: 1 }), sound({ eventId: 'e2', start: 1, end: 3 })],
    }),
  );
  assert.ok(r.bars.every((b) => b.overlap === 0 && b.maxConcurrent === 1));
  assert.equal(r.bars.at(-1)!.end, 3);
  assert.equal(r.bars.at(-1)!.coverage, 1);
});

test('dense child placement reduces chord attacks, softens pulse, and never adds melody under occupied spans', () => {
  const sparse = ready(input()),
    dense = ready(
      input({
        sounds: [sound({ start: 0, end: 20 }), sound({ eventId: 'e2', n: 2, start: 1, end: 18 })],
      }),
    );
  assert.ok(
    dense.music.notes.filter((n) => n.part === 'chord').length <
      sparse.music.notes.filter((n) => n.part === 'chord').length,
  );
  assert.equal(dense.music.notes.filter((n) => n.part === 'melody').length, 0);
  assert.ok(
    dense.music.notes.filter((n) => n.part === 'bass')[0]!.accent <
      sparse.music.notes.filter((n) => n.part === 'bass')[0]!.accent,
  );
});

test('melody phrases fit gaps with margins, use the song grid, and retain breathing room', () => {
  const v = input({ sounds: [sound(), sound({ eventId: 'e2', n: 2, start: 10, end: 11 })] }),
    r = ready(v);
  const notes = r.music.notes.filter((n) => n.part === 'melody');
  assert.ok(notes.length > 4);
  for (const n of notes)
    for (const s of v.sounds)
      assert.ok(
        n.at + n.length <= s.start - TEXTBOOK_RULES.answer.marginSeconds + 1e-8 ||
          n.at >= s.end + TEXTBOOK_RULES.answer.marginSeconds - 1e-8,
      );
  const rests = notes.slice(1).map((n, i) => n.at - notes[i]!.at - notes[i]!.length);
  assert.ok(rests.some((rest) => rest >= r.portrait.beat));
});

test('local high/low and rising/falling choices change the answer rather than moving child events', () => {
  const high = ready(input()),
    low = ready(input({ sounds: [sound({ pitch: 'low' })] }));
  const avg = (r: typeof high) => {
    const ns = r.music.notes.filter((n) => n.part === 'melody');
    return ns.reduce((s, n) => s + n.midi, 0) / ns.length;
  };
  assert.ok(avg(high) < avg(low));
  const rising = high.music.notes.filter((n) => n.part === 'melody').slice(0, 4);
  const falling = ready(input({ sounds: [sound({ contour: 'falling' })] }))
    .music.notes.filter((n) => n.part === 'melody')
    .slice(0, 4);
  assert.ok(rising.at(-1)!.midi > rising[0]!.midi);
  assert.ok(falling.at(-1)!.midi < falling[0]!.midi);
});

test('duration and appearance affect motif length and accompaniment, without changing the song clock', () => {
  const short = ready(input()),
    long = ready(input({ sounds: [sound({ length: 'long' })] }));
  assert.ok(
    long.plan.motif.beats.reduce((a, b) => a + b) > short.plan.motif.beats.reduce((a, b) => a + b),
  );
  const repeated = ready(input({ sounds: [sound({ pattern: 'repeat' })] }));
  assert.ok(repeated.plan.sections.some((s) => s.pattern === 'ostinato'));
  const texture = ready(input({ sounds: [sound({ kind: 'texture' })] }));
  assert.equal(texture.plan.sections[0]!.pattern, 'pad');
  assert.equal(texture.plan.sections.at(-1)!.pattern, 'block');
  assert.equal(short.music.tempo, long.music.tempo);
});

test('a feature without evidence is not treated as a chosen or measured contour', () => {
  const v = input({ sounds: [sound({ contour: 'falling', sources: { contour: 'unknown' } })] });
  const neutral = input({ sounds: [sound({ contour: null, sources: { contour: 'unknown' } })] });
  assert.deepEqual(ready(v).music.notes, ready(neutral).music.notes);
});

test('free and unreliable pulses decline honestly; even pulse has no fabricated strong accents', () => {
  const textbook = { ...textbookTracks[1]! };
  assert.deepEqual(composeTextbook(input({ textbook: { ...textbook, pulse: 'none' } })), {
    status: 'unavailable',
    reason: 'free-pulse',
  });
  assert.equal(
    composeTextbook(
      input({ textbook: { ...textbook, extraction: { ...textbook.extraction, confidence: 0.1 } } }),
    ).status,
    'unavailable',
  );
  const r = ready(input({ textbook: { ...textbook, pulse: 'even' } }));
  assert.equal(r.facts.metre, 'internal');
  assert.equal(
    new Set(r.music.notes.filter((n) => n.part === 'rhythm').map((n) => n.accent)).size,
    1,
  );
  const missing = ready(input({ textbook: { ...textbook, rhythmCell: [] } }));
  assert.equal(missing.facts.rhythm, 'beats');
});

test('notes stay inside time and legal pitch scales for short, truncated and maximum-length works', () => {
  for (const seconds of [0.2, 1, 2.3, 20, 47.8, 60])
    for (const mood of [null, 'sad', 'curious'] as const) {
      const r = ready(input({ seconds, mood, sounds: [] }));
      const scale = BACKGROUND_RULES.modes[r.music.mode].scale;
      for (const n of r.music.notes) {
        assert.ok(n.at >= 0 && n.length > 0 && n.at + n.length <= seconds + 1e-8);
        if (n.part !== 'rhythm')
          assert.ok(scale.includes((((n.midi - r.music.tonic) % 12) + 12) % 12));
      }
      assert.ok(r.music.notes.length <= TEXTBOOK_RULES.limits.maxNotes);
    }
});

test('same input reproduces notes; identity changes with source token, exact features, song and rules', () => {
  const v = input(),
    r = ready(v);
  assert.deepEqual(r, ready(structuredClone(v)));
  const variants = [
    { ...v, contentToken: 'ai:0000000000000001' },
    { ...v, textbook: { ...v.textbook, repetition: 'high' as const } },
    { ...v, sounds: [sound({ intensity: 'soft' })] },
  ];
  for (const other of variants) assert.notEqual(ready(other).identity, r.identity);
  assert.equal(
    ready({ ...v, textbook: { ...v.textbook, title: '只改显示名' } }).identity,
    r.identity,
  );
  assert.equal(
    ready({ ...v, sounds: [sound({ sources: { ...sound().sources, intensity: 'measurement' } })] })
      .identity === r.identity,
    false,
  );
});

test('maximum valid subdivision stays bounded and long grouping never invents overlong motif notes', () => {
  const fast = { ...base, tempoBpm: 200, rhythmCell: [0.25] };
  assert.ok(ready(input({ seconds: 60, textbook: fast, sounds: [] })).music.notes.length < 4000);
  const varied = { ...base, rhythmCell: [1.75, 4] };
  const r = ready(input({ textbook: varied, sounds: [sound({ length: 'long' })] }));
  assert.ok(r.plan.motif.beats.every((n) => n > 0 && n <= 4));
});
test('换一换: take 0 is the first version; each later take is another, reproducible version on the same song clock', () => {
  const versions = Array.from({ length: TEXTBOOK_TAKES }, (_, take) => ready(input({ take })));
  assert.deepEqual(versions[0], ready(input()));
  assert.equal(
    new Set(versions.map((made) => JSON.stringify(made.music.notes))).size,
    TEXTBOOK_TAKES,
  );
  assert.equal(new Set(versions.map((made) => made.identity)).size, TEXTBOOK_TAKES);
  versions.forEach((made, take) => {
    assert.deepEqual(ready(input({ take })), made);
    // The song's clock and the child's sounds stay as they are: same tempo, metre, cadence and ducking.
    assert.equal(made.music.tempo, versions[0]!.music.tempo);
    assert.equal(made.music.metre, versions[0]!.music.metre);
    assert.equal(made.music.cadenceAt, versions[0]!.music.cadenceAt);
    assert.deepEqual(made.music.duck, versions[0]!.music.duck);
  });
  for (const take of [-1, 1.5, 100]) assert.equal(isTextbookComposeInput(input({ take })), false);
});
