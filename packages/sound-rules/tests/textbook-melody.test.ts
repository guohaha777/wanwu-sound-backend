import test from 'node:test';
import assert from 'node:assert/strict';
import type { TextbookMelody } from '@wanwu-v2/contracts/textbook-melody';
import { isTextbookMelody } from '@wanwu-v2/contracts/textbook-melody';
import type { TextbookComposeInput, TextbookSound } from '@wanwu-v2/contracts/textbook-compose';
import { composeTextbook } from '../src/textbookCompose.ts';
const melody: TextbookMelody = {
  version: 'textbook-melody-v1',
  source: 'basic-pitch',
  modelVersion: 'synthetic-fixture',
  audioToken: 'a'.repeat(64),
  status: 'extracted',
  excerptStart: 0,
  excerptSeconds: 20,
  tempo: 96,
  confidence: 0.8,
  phrases: [
    {
      id: 'p1',
      startBeat: 0,
      endBeat: 4,
      notes: [60, 62, 64, 67].map((midi, i) => ({ atBeat: i, beats: 1, midi, confidence: 0.8 })),
    },
    {
      id: 'p2',
      startBeat: 4,
      endBeat: 8,
      notes: [72, 69, 65, 60].map((midi, i) => ({
        atBeat: 4 + i,
        beats: 1,
        midi,
        confidence: 0.8,
      })),
    },
  ],
};
const sound = (start: number, end: number, n = 1): TextbookSound => ({
  eventId: `e${n}`,
  n,
  start,
  end,
  pitch: 'mid',
  length: 'short',
  contour: null,
  intensity: 'medium',
  pattern: 'once',
  kind: 'one',
  brightness: 'mid',
  sources: {
    pitch: 'child',
    length: 'child',
    contour: 'unknown',
    intensity: 'child',
    pattern: 'child',
  },
});
const input = (sounds: TextbookSound[]): TextbookComposeInput => ({
  version: 'textbook-compose-v1',
  seconds: 20,
  mood: null,
  sounds,
  textbook: {
    version: 'textbook-v1',
    id: 'test:melody',
    title: '合成谱例',
    source: null,
    tempoBpm: 96,
    meter: 2,
    rhythmCell: [1, 1],
    mode: 'major',
    tonic: 0,
    mood: 'happy',
    onsetDensity: 'medium',
    pitchRange: { low: 60, high: 72 },
    brightness: 'mid',
    repetition: 'medium',
    childLine: '测试',
    extraction: { numbers: 'example', words: 'example', earChecked: false, confidence: 1 },
    melody,
  },
});
const ready = (v: TextbookComposeInput) => {
  const r = composeTextbook(v);
  assert.equal(r.status, 'ready');
  if (r.status !== 'ready') throw new Error('not-ready');
  return r;
};
test('all source-based melody notes have real phrase references; no generated replacement tune survives', () => {
  const r = ready(input([sound(1, 1.5)]));
  assert.ok(r.quotes.length > 0);
  assert.equal(r.facts.melody, 'extracted');
  const allowed = new Set(melody.phrases.flatMap((p) => p.notes.map((n) => n.midi)));
  for (const n of r.music.notes.filter((n) => n.part === 'melody')) assert.ok(allowed.has(n.midi));
  assert.ok(
    r.quotes.every(
      (q) => melody.phrases.some((p) => p.id === q.phraseId) && q.sourceNotes.length >= 2,
    ),
  );
});
test('two formerly identical dense arrangements now differ in actual notes while keeping the source clock', () => {
  const a = ready(input([sound(0, 12), sound(4, 18, 2)])),
    b = ready(input([sound(0, 14), sound(2, 18, 2)]));
  assert.notDeepEqual(a.music.notes, b.music.notes);
  assert.notDeepEqual(a.quotes, b.quotes);
  assert.equal(a.music.tempo, b.music.tempo);
  assert.equal(a.music.metre, b.music.metre);
});
test('changed time distribution, voice sequence, register and contour have musical consequences; ids do not', () => {
  const base = input([sound(1, 1.5), sound(8, 8.5, 2)]),
    a = ready(base);
  const changed = [
    input([sound(2, 2.5), sound(11, 11.5, 2)]),
    input([{ ...sound(1, 1.5), pitch: 'low' }, sound(8, 8.5, 2)]),
    input([
      { ...sound(1, 1.5), contour: 'falling', sources: { contour: 'child' } },
      sound(8, 8.5, 2),
    ]),
  ];
  for (const v of changed) assert.notDeepEqual(ready(v).music.notes, a.music.notes);
  const ids = structuredClone(base);
  ids.sounds = ids.sounds.map((s) => ({ ...s, eventId: s.eventId + 'new' }));
  assert.deepEqual(ready(ids).music.notes, a.music.notes);
  assert.deepEqual(ready(structuredClone(base)), a);
});
test('mood fitting is tracked as a variation, and original tempo is unchanged', () => {
  const v = input([sound(1, 1.5)]);
  v.mood = 'sad';
  const r = ready(v);
  assert.equal(r.music.mode, 'minor');
  assert.equal(r.music.tempo, 96);
  assert.ok(r.quotes.every((q) => q.transform.includes('mode-fit')));
});
test('uncertain, empty and malformed transcriptions cannot masquerade as usable melody', () => {
  assert.ok(isTextbookMelody(melody));
  assert.equal(isTextbookMelody({ ...melody, phrases: [] }), false);
  assert.equal(
    isTextbookMelody({
      ...melody,
      phrases: [{ ...melody.phrases[0]!, notes: [{ ...melody.phrases[0]!.notes[0]!, midi: NaN }] }],
    }),
    false,
  );
  const v = input([sound(1, 1.5)]);
  v.textbook.melody = { ...melody, status: 'uncertain' };
  const r = ready(v);
  assert.equal(r.quotes.length, 0);
  assert.equal(r.facts.melody, 'feature-only');
});
test('source quoting and reversals stay bounded for short and truncated works', () => {
  for (const seconds of [0.2, 1, 2.3, 20, 47.8, 60]) {
    const v = input([]);
    v.seconds = seconds;
    const r = ready(v);
    assert.ok(
      r.music.notes.every(
        (n) =>
          n.at >= 0 && n.length > 0 && n.at + n.length <= seconds + 1e-8 && Number.isFinite(n.midi),
      ),
    );
  }
});
