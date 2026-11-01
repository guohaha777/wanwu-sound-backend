// Measures a song recording for a textbook feature card. Everything here is counted from the sound, no model involved:
// - tempo from the periodicity of note onsets (spectral flux), with a gentle preference for walking pace;
// - metre from where the bass comes in (oom-pah-pah: a bass note every third beat is 3/4) when it clearly groups the
//   beats, otherwise from which bar length (2 / 3 / 4 beats) repeats best; the strong beat where the bass comes in,
//   else where the chords change (harmony moves on the bar line), else on the loudest onsets;
// - rhythm candidates: each bar's onsets snapped to the beat grid, the patterns that recur (internal: the model or
//   pickRhythm chooses one, nobody else sees them);
// - key and mode from the pitch-class profile (major / minor / pentatonic), brightness from the spectral centroid,
//   density from onsets per beat, a rough melody range, and how much bars repeat.
// Before any of that a precheck asks whether it is music at all, and three sound features are measured, each on its own:
// rhythm (steady / free), texture (one line / accompanied) and drums (yes / no); 人声 is only heard by the audio model.
// Their combination picks the measuring path: which cue finds the beat, whether a tempo is claimed at all, and how the
// key evidence (the whole recording, the bass, the last notes) is weighted. Thresholds and paths are in sound-rules
// music-types.v1.json.
// Rough by design: recordings carry accompaniment. Numbers the official docs say the audio model cannot judge (tempo,
// key) come from here; the model listens for what is characteristic.
import type { Brightness, Density, Level, Metre, TextbookMode } from '@wanwu-v2/contracts/textbook';
import { MUSIC_TYPES_RULES } from '@wanwu-v2/sound-rules/rules';
import type { MeasurePath, MusicTypesRules } from '@wanwu-v2/sound-rules/rules';
import { magnitudes } from './fft.ts';

export const MEASURE_VERSION = 'music-features-v2';
const FRAME = 2048,
  HOP = 512,
  TARGET_RATE = 22050;
/** Below this the onsets count as bass (the accompaniment's strong-beat notes). */
const BASS_HZ = 250;
/** How much stronger the bass's beat in a bar must be than its other beats before it decides the metre (0–1). */
const BASS_GROUPING = 0.45;
/** How much more the chords must change on one beat of the bar than on the others before it is taken as the first. */
const CHORD_CHANGE = 0.15;
/** The bass marks the beat when it is this many times stronger on one grid than half a beat away. */
const BASS_ON_BEAT = 2;
/** Onset energy above this counts as percussive (cymbals, snare, hi-hat). */
const DRUM_HZ = 5000;
/** The bass line's pitch classes are read from this band. */
const BASS_LOW_HZ = 50;

/** A bar pattern found in the recording, in beats (sums to one bar), and how many bars had it. */
export type RhythmCandidate = { cell: number[]; bars: number };
/**
 * What the precheck and the sound features are decided from, each 0–1: how clearly the onsets repeat at one beat
 * (steady), how much of the sound is
 * in a few pitch classes (tonal), how much one pitch class leads (solo: one line, no chords), and the share of onset
 * energy above DRUM_HZ (drums).
 */
export type SoundTraits = { steady: number; tonal: number; solo: number; drums: number };
/** The sound features, each measured on its own (人声 is left to the audio model). */
export type SoundFeatures = {
  rhythm: 'steady' | 'free';
  texture: 'solo' | 'accompanied';
  drums: boolean;
};
export type Measurement = {
  version: typeof MEASURE_VERSION;
  seconds: number;
  /** False when the precheck finds almost no steady pitch (noise, speech): no teaching card is to be made. */
  musical: boolean;
  features: SoundFeatures;
  traits: SoundTraits;
  /** The measuring path the features chose (music-types.v1.json `paths`). */
  path: MeasurePath;
  /** False for free-rhythm recordings and non-music: tempo, metre and the strong beat are then not to be used. */
  steady: boolean;
  /** Whether the strong beat is measured well enough on this path to be marked (else only an even beat). */
  strongBeat: boolean;
  tempoBpm: number;
  meter: Metre;
  meterConfidence: number;
  /** When the first full bar starts in the recording (seconds): with tempoBpm and meter, where every strong beat falls. */
  downbeatSeconds: number;
  onsetsPerBeat: number;
  onsetDensity: Density;
  centroidHz: number;
  brightness: Brightness;
  mode: TextbookMode;
  tonic: number;
  keyConfidence: number;
  pitchRange: { low: number; high: number };
  repetition: Level;
  candidates: RhythmCandidate[];
};

const percentile = (values: ArrayLike<number>, p: number) => {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))]!
    : 0;
};
// Krumhansl–Kessler key profiles (C major, C minor).
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
/** Pearson correlation of two equally long lists. */
function correlation(a: readonly number[], b: readonly number[]) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Mono samples at any rate (the page decodes with Web Audio; the server with FFmpeg). */
export function measure(
  input: Float32Array,
  sampleRate: number,
  types: MusicTypesRules = MUSIC_TYPES_RULES,
): Measurement {
  // Down to about 22 kHz by block averaging: enough for onsets, pitch classes and brightness.
  const factor = Math.max(1, Math.floor(sampleRate / TARGET_RATE));
  const rate = sampleRate / factor;
  const samples = new Float32Array(Math.floor(input.length / factor));
  let peak = 1e-9;
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += input[i * factor + k]!;
    samples[i] = sum / factor;
    peak = Math.max(peak, Math.abs(samples[i]!));
  }
  // Normalised to the loudest sample.
  for (let i = 0; i < samples.length; i++) samples[i] = samples[i]! / peak;
  const seconds = input.length / sampleRate;
  const fps = rate / HOP;
  const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  if (frames < fps * 8) throw new Error('recording-too-short');

  // ----- One pass over the spectrum frames: onset curves, energy, brightness, pitch classes, melody pitch -----
  const window = new Float32Array(FRAME).map(
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)),
  );
  const binHz = rate / FRAME;
  const bins = FRAME / 2 + 1;
  // Pitch class of every bin from 80 Hz to 2 kHz (-1 outside); the melody is looked for between 200 Hz and 1.1 kHz.
  const pitchClass = new Int8Array(bins).fill(-1);
  const melodyLow = Math.ceil(200 / binHz);
  const melodyHigh = Math.floor(1100 / binHz);
  for (let k = 1; k < bins; k++) {
    const f = k * binHz;
    if (f > 80 && f < 2000)
      pitchClass[k] = (((Math.round(12 * Math.log2(f / 440)) + 69) % 12) + 12) % 12;
  }
  const bassTop = Math.floor(BASS_HZ / binHz);
  const bassFlux = new Float32Array(frames);
  const drumFrom = Math.ceil(DRUM_HZ / binHz);
  const bassClass = new Int8Array(bins).fill(-1);
  for (let k = Math.ceil(BASS_LOW_HZ / binHz); k <= bassTop; k++)
    bassClass[k] = (((Math.round(12 * Math.log2((k * binHz) / 440)) + 69) % 12) + 12) % 12;
  const bassChroma = new Float32Array(frames * 12);
  const drumFlux = new Float32Array(frames);
  const allFlux = new Float32Array(frames);
  const flux = new Float32Array(frames);
  const energy = new Float32Array(frames);
  const centroid = new Float32Array(frames);
  const f0 = new Float32Array(frames);
  const chroma = new Float32Array(frames * 12);
  const frame = new Float32Array(FRAME);
  let previous: Float32Array | null = null;
  for (let t = 0; t < frames; t++) {
    for (let i = 0; i < FRAME; i++) frame[i] = samples[t * HOP + i]! * window[i]!;
    const spectrum = magnitudes(frame, FRAME);
    const logs = new Float32Array(bins);
    let sum = 0,
      weighted = 0,
      rise = 0,
      bassRise = 0,
      drumRise = 0,
      allRise = 0,
      best = 0,
      bestBin = melodyLow;
    for (let k = 0; k < bins; k++) {
      const m = spectrum[k]!;
      logs[k] = Math.log1p(10 * m);
      sum += m;
      weighted += m * k * binHz;
      if (previous) {
        rise += Math.max(0, logs[k]! - previous[k]!);
        // Percussive share in plain magnitude, like the bass: on a log scale every high bin's faint rise would count.
        const up = Math.max(0, m - Math.expm1(previous[k]!) / 10);
        allRise += up;
        if (k >= drumFrom) drumRise += up;
        // The bass in plain magnitude: a log scale would count a high note's click, which leaks into every bin.
        if (k <= bassTop) bassRise += Math.max(0, m - Math.expm1(previous[k]!) / 10);
      }
      const pc = pitchClass[k]!;
      if (pc >= 0) chroma[t * 12 + pc] = chroma[t * 12 + pc]! + m;
      const bc = bassClass[k]!;
      if (bc >= 0) bassChroma[t * 12 + bc] = bassChroma[t * 12 + bc]! + m;
      if (k >= melodyLow && k <= melodyHigh && m > best) {
        best = m;
        bestBin = k;
      }
    }
    flux[t] = rise;
    bassFlux[t] = bassRise;
    drumFlux[t] = drumRise;
    allFlux[t] = allRise;
    energy[t] = sum;
    centroid[t] = sum ? weighted / sum : 0;
    f0[t] = bestBin * binHz;
    previous = logs;
  }

  // Onset envelope, smoothed; its autocorrelation gives the beat.
  const smooth = new Float32Array(frames);
  const kernel = [0.25, 0.5, 1, 0.5, 0.25];
  for (let t = 0; t < frames; t++) {
    let s = 0;
    for (let j = -2; j <= 2; j++) s += (flux[t + j] ?? 0) * kernel[j + 2]!;
    smooth[t] = s / 2.5;
  }
  const mean = smooth.reduce((s, v) => s + v, 0) / frames;
  const env = smooth.map((v) => v - mean);
  const maxLag = Math.min(frames - 1, Math.ceil((fps * 60) / 50) * 4 + 4);
  const ac = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let t = 0; t + lag < frames; t++) s += env[t]! * env[t + lag]!;
    ac[lag] = s;
  }
  const zero = ac[0] || 1;
  for (let lag = 0; lag <= maxLag; lag++) ac[lag] = ac[lag]! / zero;
  // The beat: the strongest lag between 55 and 185 bpm, preferring tempos near 100.
  let lag = 0,
    bestScore = -Infinity;
  for (let l = Math.ceil((fps * 60) / 185); l <= Math.floor((fps * 60) / 55) && l < maxLag; l++) {
    const bpm = (60 * fps) / l;
    const score = ac[l]! * Math.exp(-0.5 * (Math.log2(bpm / 100) / 0.9) ** 2);
    if (score > bestScore) {
      bestScore = score;
      lag = l;
    }
  }
  // Parabolic peak for a fractional beat length.
  const [a, b, c] = [ac[lag - 1] ?? 0, ac[lag]!, ac[lag + 1] ?? 0];
  const shift = a - 2 * b + c ? (a - c) / (2 * (a - 2 * b + c)) : 0;
  const beat = lag + Math.max(-0.5, Math.min(0.5, shift));
  const tempoBpm = Math.round((60 * fps) / beat);
  /** The autocorrelation near a lag of `beats` beats (its best within ±2 frames): how well bars of that size repeat. */
  const near = (beats: number) => {
    const l = Math.round(beat * beats);
    let m = -1;
    for (let i = l - 2; i <= l + 2; i++) if (i > 0 && i <= maxLag) m = Math.max(m, ac[i]!);
    return m;
  };
  const scores = { 2: near(2), 3: near(3), 4: near(4) };
  const sortedScores = Object.values(scores).sort((x, y) => y - x);

  // The precheck and the sound features, from four traits over the louder frames; their combination picks the path that
  // decides how the rest is measured (free rhythm first, then drums, then one line or accompanied).
  const loudFloor = percentile(energy, 50);
  let tonalSum = 0,
    soloSum = 0,
    counted = 0;
  for (let t = 0; t < frames; t++) {
    if (energy[t]! <= loudFloor) continue;
    const v = Array.from(chroma.subarray(t * 12, t * 12 + 12)).sort((x, y) => y - x);
    const all = v.reduce((s, x) => s + x, 0);
    if (!all) continue;
    tonalSum += (v[0]! + v[1]! + v[2]!) / all;
    soloSum += v[0]! / all;
    counted++;
  }
  const fluxTotal = allFlux.reduce((s, v) => s + v, 0) || 1;
  const traits: SoundTraits = {
    steady: Math.max(0, ac[lag]!),
    tonal: counted ? tonalSum / counted : 0,
    solo: counted ? soloSum / counted : 0,
    drums: drumFlux.reduce((s, v) => s + v, 0) / fluxTotal,
  };
  const d = types.detect;
  const musical = traits.tonal >= types.precheck.tonalBelow;
  const features: SoundFeatures = {
    rhythm: traits.steady < d.steadyBelow ? 'free' : 'steady',
    texture: traits.solo > d.soloAbove ? 'solo' : 'accompanied',
    drums: traits.drums > d.drumsAbove,
  };
  // Not music: nothing to count, so like free rhythm no tempo is claimed.
  const pathName: MeasurePath =
    !musical || features.rhythm === 'free' ? 'free' : features.drums ? 'drums' : features.texture;
  const path = types.paths[pathName];
  const useBass = path.beatCue === 'bass' || path.beatCue === 'drums';

  // Beat phase: where the onsets line up — but where the bass clearly keeps to one grid, on the bass (the melody's
  // eighths can be busier on the off-beat than on the beat; the bass and kick mark the beat).
  const bassEnv = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    let s = 0;
    for (let j = -2; j <= 2; j++) s += (bassFlux[t + j] ?? 0) * kernel[j + 2]!;
    bassEnv[t] = s / 2.5;
  }
  const at = (position: number) => env[Math.round(position)] ?? 0;
  /** How much of a curve falls on the beat grid that starts at frame `p`. */
  const onGrid = (curve: Float32Array, p: number) => {
    let s = 0;
    for (let x = p; x < frames; x += beat) s += curve[Math.round(x)] ?? 0;
    return s;
  };
  let phase = 0,
    phaseScore = -Infinity,
    bassPhase = 0,
    bassScore = -Infinity;
  for (let p = 0; p < Math.ceil(beat); p++) {
    const s = onGrid(env, p);
    if (s > phaseScore) {
      phaseScore = s;
      phase = p;
    }
    const b = onGrid(bassEnv, p);
    if (b > bassScore) {
      bassScore = b;
      bassPhase = p;
    }
  }
  // Drums: the kick is the bass band's onset and always marks the beat; a solo voice has no bass to follow.
  // Otherwise the bass is followed only when it is clearly stronger on its grid than half a beat later.
  if (
    path.beatCue === 'drums' ||
    (useBass && bassScore > BASS_ON_BEAT * onGrid(bassEnv, (bassPhase + beat / 2) % beat))
  )
    phase = bassPhase;

  // The bass on each beat, folded into bars of 2, 3 and 4: in a bar it groups, one beat stands out (oom-pah-pah). A bar
  // of 4 also stands out for a 2-beat bass, so 4 has to beat 2 clearly.
  const bassOnBeats: number[] = [];
  for (let x = phase; x < frames; x += beat) {
    let m = 0;
    for (let j = -2; j <= 2; j++) m = Math.max(m, bassEnv[Math.round(x) + j] ?? 0);
    bassOnBeats.push(m);
  }
  const grouping = (size: number) => {
    const profile = new Array<number>(size).fill(0);
    const bars = Math.floor(bassOnBeats.length / size);
    for (let i = 0; i < bars * size; i++) profile[i % size] = profile[i % size]! + bassOnBeats[i]!;
    const top = Math.max(...profile);
    const strong = profile.indexOf(top);
    const rest = profile.filter((_, i) => i !== strong);
    // How far the strong beat stands above the others, as a share of it.
    return {
      contrast: top ? (top - rest.reduce((s, v) => s + v, 0) / rest.length) / top : 0,
      strong,
    };
  };
  const bass = { 2: grouping(2), 3: grouping(3), 4: grouping(4) };
  // 3 when the bass groups in threes better than in twos and fours; else 2, or 4 when it groups clearly better in four.
  const bassMeter: Metre | null = !useBass
    ? null
    : bass[3].contrast >= BASS_GROUPING &&
        bass[3].contrast > Math.max(bass[2].contrast, bass[4].contrast)
      ? 3
      : bass[2].contrast >= BASS_GROUPING
        ? bass[4].contrast > bass[2].contrast * 1.3
          ? 4
          : 2
        : null;
  // Without the bass: the onsets' autocorrelation (3 and 4 must win by a margin, else 2).
  const meter: Metre =
    bassMeter ??
    (scores[3] > Math.max(scores[2], scores[4]) * 1.05 ? 3 : scores[4] > scores[2] * 1.15 ? 4 : 2);
  const meterConfidence = bassMeter
    ? Math.min(1, bass[bassMeter].contrast)
    : Math.max(
        0,
        Math.min(
          1,
          ((sortedScores[0]! - sortedScores[1]!) / Math.max(0.05, Math.abs(sortedScores[0]!))) * 4,
        ),
      );

  // Which beat of the bar is strong: where the bass comes in when it groups the beats; else where the chords change (how
  // different each beat's pitch classes are from the beat before, folded into bars); else the loudest onsets.
  const beatChroma: number[][] = [];
  for (let x = phase; x + beat <= frames; x += beat) {
    const v = new Array<number>(12).fill(0);
    for (let t = Math.round(x); t < Math.round(x + beat); t++)
      for (let k = 0; k < 12; k++) v[k] = v[k]! + chroma[t * 12 + k]!;
    const length = Math.hypot(...v) || 1;
    beatChroma.push(v.map((value) => value / length));
  }
  const change = new Array<number>(meter).fill(0);
  for (let i = 1; i < beatChroma.length; i++)
    change[i % meter] =
      change[i % meter]! +
      1 -
      beatChroma[i]!.reduce((s, value, k) => s + value * beatChroma[i - 1]![k]!, 0);
  const mostChange = Math.max(...change);
  const changeAt = change.indexOf(mostChange);
  const otherChange = (change.reduce((s, v) => s + v, 0) - mostChange) / Math.max(1, meter - 1);
  let downbeat = bassMeter
    ? bass[bassMeter].strong
    : mostChange > otherChange * (1 + CHORD_CHANGE)
      ? changeAt
      : -1;
  let downScore = -Infinity;
  if (downbeat < 0)
    for (let m = 0; m < meter; m++) {
      let s = 0;
      for (let x = phase + m * beat; x < frames; x += beat * meter) s += at(x);
      if (s > downScore) {
        downScore = s;
        downbeat = m;
      }
    }

  // Onsets: local peaks above the upper quartile and a quarter of the strongest onsets (sparse songs would otherwise
  // count the accompaniment's small ripples), at least 0.12 s apart.
  const threshold = Math.max(percentile(smooth, 75), 0.25 * percentile(smooth, 99.5));
  const gap = 0.12 * fps;
  const onsets: number[] = [];
  for (let t = 1; t < frames - 1; t++)
    if (
      smooth[t]! > threshold &&
      smooth[t]! >= smooth[t - 1]! &&
      smooth[t]! > smooth[t + 1]! &&
      (!onsets.length || t - onsets.at(-1)! >= gap)
    )
      onsets.push(t);
  const onsetsPerBeat = onsets.length / (frames / beat);
  const onsetDensity: Density =
    onsetsPerBeat < 1.1 ? 'sparse' : onsetsPerBeat > 2 ? 'busy' : 'medium';

  // Each bar's onsets on the beat grid (half beats, quarter beats when clearly there); bars that start with a note.
  const barsSeen = new Map<number, Set<number>>();
  const origin = phase + downbeat * beat;
  for (const t of onsets) {
    const position = (t - origin) / beat;
    if (position < -0.25) continue;
    let q = Math.round(position * 2) / 2;
    if (Math.abs(position - q) > 0.15) q = Math.round(position * 4) / 4;
    let bar = Math.floor(q / meter + 1e-9),
      inBar = q - bar * meter;
    if (inBar >= meter - 1e-9) {
      bar++;
      inBar = 0;
    }
    if (!barsSeen.has(bar)) barsSeen.set(bar, new Set());
    barsSeen.get(bar)!.add(inBar);
  }
  const counts = new Map<string, RhythmCandidate>();
  for (const positions of barsSeen.values()) {
    const sorted = [...positions].sort((x, y) => x - y);
    if (sorted[0] !== 0 || sorted.length > 16) continue;
    const cell = sorted.map((p, i) => (sorted[i + 1] ?? meter) - p);
    if (cell.some((d) => d < 0.25 || d > 4)) continue;
    const key = cell.join(',');
    const known = counts.get(key);
    if (known) known.bars++;
    else counts.set(key, { cell, bars: 1 });
  }
  const ranked = [...counts.values()].sort((x, y) => y.bars - x.bars);
  const candidates = ranked.filter((item) => item.bars >= 2).slice(0, 5);
  if (!candidates.length && ranked[0]) candidates.push(ranked[0]);

  // Brightness and key from the louder frames.
  const loudish = percentile(energy, 30);
  const loud = percentile(energy, 60);
  const centroids: number[] = [];
  const profile = new Array<number>(12).fill(0);
  const bassProfile = new Array<number>(12).fill(0);
  const pitches: number[] = [];
  for (let t = 0; t < frames; t++) {
    if (energy[t]! > loudish) {
      centroids.push(centroid[t]!);
      for (let k = 0; k < 12; k++) {
        profile[k] = profile[k]! + chroma[t * 12 + k]!;
        bassProfile[k] = bassProfile[k]! + bassChroma[t * 12 + k]!;
      }
    }
    if (energy[t]! > loud) pitches.push(69 + 12 * Math.log2(f0[t]! / 440));
  }
  const centroidHz = Math.round(percentile(centroids, 50));
  const brightness: Brightness = centroidHz < 1500 ? 'dark' : centroidHz > 2500 ? 'bright' : 'mid';
  // Key: each tonic and mode scored on the evidence the path weights — the whole recording's pitch classes, the
  // bass line's (bass notes sit on the tonic most), and the last notes before the recording falls quiet (a children's
  // song ends on its tonic).
  const normal = (v: readonly number[]) => {
    const total = v.reduce((s, x) => s + x, 0) || 1;
    return v.map((x) => x / total);
  };
  const norm = normal(profile);
  const bassNorm = normal(bassProfile);
  let lastLoud = frames - 1;
  while (lastLoud > 0 && energy[lastLoud]! <= loudish) lastLoud--;
  const ending = new Array<number>(12).fill(0);
  for (
    let t = Math.max(0, lastLoud - Math.round(types.key.endingSeconds * fps));
    t <= lastLoud;
    t++
  )
    for (let k = 0; k < 12; k++) ending[k] = ending[k]! + chroma[t * 12 + k]!;
  const endingTop = Math.max(...ending) || 1;
  const w = path.key;
  const weights = w.whole + w.bass + w.ending || 1;
  let tonic = 0,
    major = true,
    keyConfidence = -Infinity;
  for (let shift = 0; shift < 12; shift++)
    for (const [template, isMajor] of [
      [MAJOR, true],
      [MINOR, false],
    ] as const) {
      const rotated = template.map((_, i) => template[(i - shift + 12) % 12]!);
      const score =
        (w.whole * correlation(norm, rotated) +
          w.bass * correlation(bassNorm, rotated) +
          (w.ending * ending[shift]!) / endingTop) /
        weights;
      if (score > keyConfidence) {
        keyConfidence = score;
        tonic = shift;
        major = isMajor;
      }
    }
  // Major without a clear 4th and 7th is pentatonic.
  const mode: TextbookMode = !major
    ? 'minor'
    : norm[(tonic + 5) % 12]! + norm[(tonic + 11) % 12]! < 0.09
      ? 'pentatonic'
      : 'major';
  // Pitch range: 5th to 95th percentile of the melody pitch in the loud frames.
  const low = Math.max(21, Math.round(percentile(pitches, 5)));
  const high = Math.min(108, Math.max(low + 1, Math.round(percentile(pitches, 95))));

  // Repetition: how alike bars four bars apart sound (pitch classes).
  const barFrames = Math.max(1, Math.round(beat * meter));
  const barVectors: number[][] = [];
  for (let start = Math.round(origin); start + barFrames <= frames; start += barFrames) {
    const v = new Array<number>(12).fill(0);
    for (let t = start; t < start + barFrames; t++)
      for (let k = 0; k < 12; k++) v[k] = v[k]! + chroma[t * 12 + k]!;
    const length = Math.hypot(...v) || 1;
    barVectors.push(v.map((x) => x / length));
  }
  const similarities: number[] = [];
  for (let i = 0; i + 4 < barVectors.length; i++)
    similarities.push(barVectors[i]!.reduce((s, x, k) => s + x * barVectors[i + 4]![k]!, 0));
  const alike = similarities.length
    ? similarities.reduce((s, v) => s + v, 0) / similarities.length
    : 0;
  const repetition: Level = alike > 0.92 ? 'high' : alike < 0.8 ? 'low' : 'medium';

  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    version: MEASURE_VERSION,
    seconds: Math.round(seconds * 10) / 10,
    musical,
    features,
    path: pathName,
    traits: {
      steady: round(traits.steady),
      tonal: round(traits.tonal),
      solo: round(traits.solo),
      drums: round(traits.drums),
    },
    steady: path.tempo,
    strongBeat: path.strongBeat,
    tempoBpm,
    meter,
    meterConfidence: Math.round(meterConfidence * 100) / 100,
    downbeatSeconds: Math.round((((phase + downbeat * beat) * HOP) / rate) * 1000) / 1000,
    onsetsPerBeat: Math.round(onsetsPerBeat * 100) / 100,
    onsetDensity,
    centroidHz,
    brightness,
    mode,
    tonic,
    keyConfidence: Math.round(keyConfidence * 100) / 100,
    pitchRange: { low, high },
    repetition,
    candidates,
  };
}
