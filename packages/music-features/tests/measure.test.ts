import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, modelExcerpt, pickRhythm } from '../src/index.ts';

const RATE = 22050;
const C_MAJOR = [60, 64, 67],
  A_MINOR = [57, 60, 64];
/**
 * A synthetic song: a plucked note (decaying harmonics) on every onset of `cell`, louder on the strong beat, over a soft
 * held chord. Known tempo, metre, rhythm and key.
 */
function song({
  bpm,
  meter,
  cell,
  chord,
  seconds = 40,
}: {
  bpm: number;
  meter: number;
  cell: number[];
  chord: number[];
  seconds?: number;
}) {
  const out = new Float32Array(RATE * seconds),
    beat = 60 / bpm;
  const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    out[i] = 0.04 * chord.reduce((s, m) => s + Math.sin(2 * Math.PI * hz(m) * t), 0);
  }
  let at = 0,
    note = 0;
  while (at < seconds - 1) {
    for (const length of cell) {
      const start = Math.round(at * RATE),
        strong = Math.abs(at / (beat * meter) - Math.round(at / (beat * meter))) < 1e-6;
      const pitch = hz(chord[note++ % chord.length]! + 12);
      // Decays, then fades out smoothly over the last 0.1 s (a hard cut would click like a new note).
      for (let i = 0; i < RATE * 0.4 && start + i < out.length; i++) {
        const t = i / RATE,
          fade = t > 0.3 ? 0.5 + 0.5 * Math.cos((Math.PI * (t - 0.3)) / 0.1) : 1,
          decay = Math.exp(-t * 9) * fade * (strong ? 1 : 0.6);
        out[start + i] =
          out[start + i]! +
          decay *
            (Math.sin(2 * Math.PI * pitch * t) +
              0.5 * Math.sin(4 * Math.PI * pitch * t) +
              0.25 * Math.sin(6 * Math.PI * pitch * t));
      }
      at += length * beat;
    }
  }
  return out;
}

test('a 2/4 song at 96 BPM with 嘀嘀嗒: tempo, metre, rhythm and key are found', () => {
  const m = measure(song({ bpm: 96, meter: 2, cell: [0.5, 0.5, 1], chord: C_MAJOR }), RATE);
  assert.ok(Math.abs(m.tempoBpm - 96) <= 3, `tempo ${m.tempoBpm}`);
  assert.equal(m.meter, 2);
  assert.ok(
    m.candidates.some((c) => c.cell.join() === '0.5,0.5,1'),
    JSON.stringify(m.candidates),
  );
  assert.deepEqual(pickRhythm(m.candidates, m.meter), [0.5, 0.5, 1]);
  assert.equal(m.tonic, 0);
  assert.notEqual(m.mode, 'minor');
});

test('a 3/4 song at 72 BPM with 嗒— 嗒 in A minor', () => {
  const m = measure(song({ bpm: 72, meter: 3, cell: [2, 1], chord: A_MINOR }), RATE);
  assert.ok(Math.abs(m.tempoBpm - 72) <= 3, `tempo ${m.tempoBpm}`);
  assert.equal(m.meter, 3);
  assert.deepEqual(pickRhythm(m.candidates, m.meter), [2, 1], JSON.stringify(m.candidates));
  assert.equal(m.mode, 'minor');
  assert.equal(m.tonic, 9);
});

test('oom-pah-pah: an even melody over a bass note every third beat is 3/4, the bar starting with the bass', () => {
  const bpm = 136,
    beat = 60 / bpm,
    seconds = 40,
    out = song({ bpm, meter: 1, cell: [1], chord: C_MAJOR, seconds });
  // A low plucked bass (65 Hz) on the first beat of every bar of three, starting on the second beat of the recording.
  for (let at = beat; at < seconds - 1; at += 3 * beat) {
    const start = Math.round(at * RATE);
    for (let i = 0; i < RATE * 0.35 && start + i < out.length; i++) {
      const t = i / RATE;
      out[start + i] = out[start + i]! + 1.2 * Math.exp(-t * 8) * Math.sin(2 * Math.PI * 65.4 * t);
    }
  }
  const m = measure(out, RATE);
  assert.ok(Math.abs(m.tempoBpm - bpm) <= 4, `tempo ${m.tempoBpm}`);
  assert.equal(m.meter, 3);
});

test("the beat is where the bass plays, even when the melody's off-beat eighths are louder", () => {
  const bpm = 96,
    beat = 60 / bpm,
    seconds = 40,
    out = new Float32Array(RATE * seconds),
    hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  const pluck = (at: number, freq: number, level: number, decay: number) => {
    const start = Math.round(at * RATE);
    for (let i = 0; i < RATE * 0.3 && start + i < out.length; i++) {
      const t = i / RATE;
      out[start + i] =
        out[start + i]! + level * Math.exp(-t * decay) * Math.sin(2 * Math.PI * freq * t);
    }
  };
  // Bass on every beat from 0.4 s; eighths above it, the ones between the beats twice as loud.
  for (let at = 0.4, i = 0; at < seconds - 1; at += beat / 2, i++) {
    pluck(at, hz(72 + (i % 4) * 2), i % 2 ? 1 : 0.5, 12);
    if (i % 2 === 0) pluck(at, 65.4, 1.2, 8);
  }
  const m = measure(out, RATE),
    offset = ((((m.downbeatSeconds - 0.4) / beat) % 1) + 1) % 1;
  assert.ok(Math.abs(m.tempoBpm - bpm) <= 3, `tempo ${m.tempoBpm}`);
  assert.ok(
    offset < 0.12 || offset > 0.88,
    `downbeat ${m.downbeatSeconds} s is ${offset.toFixed(2)} of a beat off the bass`,
  );
});

test('higher sample rates give the same answer; too short a recording is refused', () => {
  const base = song({ bpm: 96, meter: 2, cell: [0.5, 0.5, 1], chord: C_MAJOR, seconds: 30 });
  const doubled = new Float32Array(base.length * 2);
  for (let i = 0; i < doubled.length; i++) doubled[i] = base[i >> 1]!;
  assert.equal(measure(doubled, RATE * 2).meter, measure(base, RATE).meter);
  assert.throws(() => measure(new Float32Array(RATE * 3), RATE), /too-short/);
});

test('a precheck and three sound features (rhythm, texture, drums) pick how a recording is measured', () => {
  let seed = 7;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
  const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  // A sung note: soft attack and release, a little vibrato.
  const sing = (out: Float32Array, at: number, midi: number, length: number) => {
    const f = hz(midi);
    for (let i = 0; i < length * RATE && at * RATE + i < out.length; i++) {
      const t = i / RATE,
        env = Math.min(1, t * 20, (length - t) * 20),
        p = 2 * Math.PI * f * (t + (0.004 * Math.sin(2 * Math.PI * 5.5 * t)) / (2 * Math.PI * 5.5));
      out[Math.round(at * RATE) + i] =
        out[Math.round(at * RATE) + i]! +
        0.5 * env * (Math.sin(p) + 0.4 * Math.sin(2 * p) + 0.2 * Math.sin(3 * p));
    }
  };
  // 清唱 in G major, 2/4: a steady children's tune ending on its tonic.
  const solo = new Float32Array(RATE * 40),
    tune = [67, 69, 71, 67, 67, 69, 71, 67, 71, 72, 74, 71, 72, 74],
    beats = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 2];
  let at = 0.5;
  for (let r = 0; r < 3; r++)
    tune.forEach((midi, i) => {
      sing(solo, at, midi, beats[i]! * 0.57);
      at += beats[i]! * 0.6;
    });
  sing(solo, at, 67, 1.5);
  const sung = measure(solo, RATE);
  assert.deepEqual(
    sung.features,
    { rhythm: 'steady', texture: 'solo', drums: false },
    JSON.stringify(sung.traits),
  );
  assert.equal(sung.path, 'solo');
  assert.equal(sung.musical, true);
  assert.equal(sung.tonic, 7);
  assert.equal(sung.strongBeat, false);
  // 有鼓: kick on the beat, hi-hat on every eighth, snare on the backbeat, a held chord.
  const drums = new Float32Array(RATE * 40).map(
    (_, i) =>
      0.05 *
      [55, 59, 62].reduce((sum, midi) => sum + Math.sin((2 * Math.PI * hz(midi) * i) / RATE), 0),
  );
  for (let b = 0; b * 0.5 < 39; b++) {
    const start = Math.round(b * 0.5 * RATE);
    for (let i = 0; i < 0.15 * RATE; i++) {
      const t = i / RATE;
      if (b % 2 === 0)
        drums[start + i]! +=
          0.9 * Math.exp(-t * 30) * Math.sin(2 * Math.PI * (60 + 60 * Math.exp(-t * 40)) * t);
      if (b % 2 === 1) drums[start + i]! += 0.5 * Math.exp(-t * 25) * noise();
      if (i < 0.08 * RATE) drums[start + i]! += 0.35 * Math.exp(-t * 50) * noise();
    }
  }
  const kit = measure(drums, RATE);
  assert.equal(kit.features.drums, true, JSON.stringify(kit.traits));
  assert.equal(kit.features.rhythm, 'steady');
  assert.equal(kit.path, 'drums');
  assert.equal(kit.steady, true);
  // 自由节奏: a sung line whose notes have no common beat.
  const free = new Float32Array(RATE * 40);
  at = 0.3;
  while (at < 38) {
    const length = 0.3 + (noise() + 1) * 0.8;
    sing(free, at, [62, 64, 67, 69, 72][Math.floor((noise() + 1) * 2.5) % 5]!, length * 0.95);
    at += length;
  }
  const loose = measure(free, RATE);
  assert.equal(loose.features.rhythm, 'free', JSON.stringify(loose.traits));
  assert.equal(loose.path, 'free');
  assert.equal(loose.musical, true);
  assert.equal(loose.steady, false);
  // 不是音乐: noise.
  const hiss = new Float32Array(RATE * 40).map(() => 0.3 * noise()),
    none = measure(hiss, RATE);
  assert.equal(none.musical, false, JSON.stringify(none.traits));
  assert.equal(none.steady, false);
});

test('the program prefers a varied recurring rhythm over an even pulse, and picks a 30 s excerpt', () => {
  assert.deepEqual(
    pickRhythm(
      [
        { cell: [0.5, 0.5, 0.5, 0.5], bars: 9 },
        { cell: [0.5, 0.5, 1], bars: 6 },
      ],
      2,
    ),
    [0.5, 0.5, 1],
  );
  assert.deepEqual(pickRhythm([{ cell: [1, 1], bars: 9 }], 2), [1, 1]);
  assert.deepEqual(pickRhythm([], 3), [1, 1, 1]);
  assert.deepEqual(modelExcerpt(120), { start: 10, end: 40 });
  assert.deepEqual(modelExcerpt(20), { start: 0, end: 20 });
});
