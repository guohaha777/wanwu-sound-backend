// Stage A pure textbook composer. No network, page behavior, or free-AI rules change.
import {
  TEXTBOOK_COMPOSE_VERSION,
  isTextbookComposeInput,
} from '@wanwu-v2/contracts/textbook-compose';
import type { TextbookComposeInput, TextbookSound } from '@wanwu-v2/contracts/textbook-compose';
import type { TextbookMode } from '@wanwu-v2/contracts/textbook';
import type { BackgroundNote, BackgroundPlan } from './background.ts';
import { arrangeTextbookMelody, retreatUnderSounds } from './textbookMelodyArrange.ts';
import { quotedBarChords, songProgression } from './textbookHarmony.ts';
import type { TextbookQuote } from './textbookMelodyArrange.ts';
import { BACKGROUND_RULES, MIX_RULES } from './rules.ts';
import { duckPoints, mergeSpans } from './mix.ts';
import { compositionToken } from './compositionIdentity.ts';
import { TEXTBOOK_RULES, knownFeature, textbookPortrait } from './textbookPortrait.ts';
import type { TextbookRules } from './textbookPortrait.ts';
export { TEXTBOOK_RULES, textbookPortrait };
export type { TextbookRules };
type Pattern = 'block' | 'arpeggio' | 'ostinato' | 'pad';
export type TextbookProgramPlan = {
  mode: TextbookMode;
  tonic: number;
  progression: number[];
  motif: { degrees: number[]; beats: number[] };
  sections: {
    startBar: number;
    endBar: number;
    density: 'sparse' | 'medium' | 'busy';
    pattern: Pattern;
    rhythm: 'original' | 'beats';
    answer: 'imitate' | 'rest';
    accent: number;
  }[];
};
export type TextbookComposition =
  | { status: 'unavailable'; reason: 'invalid-input' | 'free-pulse' | 'unreliable-tempo' }
  | {
      status: 'ready';
      version: typeof TEXTBOOK_COMPOSE_VERSION;
      identity: string;
      maker: 'program';
      plan: TextbookProgramPlan;
      quotes: TextbookQuote[];
      music: BackgroundPlan;
      portrait: ReturnType<typeof textbookPortrait>;
      facts: {
        metre: 'known' | 'internal';
        rhythm: 'song' | 'beats';
        earChecked: boolean;
        brightness: 'not-applied';
        melody: 'extracted' | 'feature-only';
      };
    };
// Joining adjacent source durations preserves their total timing; it does not slow the song.
const motifRhythm = (cell: readonly number[], count: number, limit: number, long: boolean) => {
  let cursor = 0;
  return Array.from({ length: count }, () => {
    if (!long) return Math.min(cell[cursor++ % cell.length]!, limit);
    let sum = 0;
    while (sum < limit - 1e-9) {
      const next = cell[cursor % cell.length]!;
      if (sum > 0 && sum + next > 4) break;
      sum += next;
      cursor++;
    }
    return sum;
  });
};
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const fitOctave = (n: number, min: number, max: number) => {
  while (n < min) n += 12;
  while (n > max) n -= 12;
  return n;
};
export function textbookRuleProblems(r: TextbookRules): string[] {
  const out: string[] = [];
  const check = (ok: boolean, message: string) => {
    if (!ok) out.push(message);
  };
  check(r.version === TEXTBOOK_COMPOSE_VERSION, 'version');
  check(
    Number.isInteger(r.quote.minNotes) &&
      r.quote.minNotes >= 2 &&
      r.quote.busyNotes >= r.quote.minNotes &&
      r.quote.busyNotes <= 6,
    'quote.notes',
  );
  check(
    r.quote.overlapRetreat > 0 &&
      r.quote.overlapRetreat <= 1 &&
      r.quote.highRegister >= 48 &&
      r.quote.highRegister <= 84,
    'quote.retreat',
  );
  check(
    r.confidence.minimumTempo > 0 &&
      r.confidence.minimumTempo <= r.confidence.strongBeat &&
      r.confidence.strongBeat <= 1,
    'confidence',
  );
  check(r.fade.inSeconds >= 0 && r.fade.outSeconds > 0 && r.fade.outSeconds <= 4, 'fade');
  check(Number.isInteger(r.sectionBars) && r.sectionBars >= 1 && r.sectionBars <= 4, 'sectionBars');
  for (const [k, v] of Object.entries(r.density))
    check(Number.isFinite(v) && v >= 0, `density.${k}`);
  check(
    r.density.sparseCoverage < r.density.busyCoverage &&
      r.density.busyCoverage <= 1 &&
      r.density.busyOverlap <= 1,
    'coverage',
  );
  check(
    r.answer.minGapBeats > 0 && r.answer.marginSeconds >= 0 && r.answer.restBeats >= 1,
    'answer.gaps',
  );
  check(
    Number.isInteger(r.answer.motifNotes) && r.answer.motifNotes >= 2 && r.answer.motifNotes <= 6,
    'answer.motifNotes',
  );
  check(
    r.answer.shortBeats > 0 &&
      r.answer.shortBeats <= r.answer.mediumBeats &&
      r.answer.mediumBeats <= r.answer.longBeats &&
      r.answer.longBeats <= 4,
    'answer.beats',
  );
  check(r.answer.notePortion > 0 && r.answer.notePortion < 1, 'answer.notePortion');
  check(
    r.register.minMidi >= 21 &&
      r.register.minMidi < r.register.maxMidi &&
      r.register.maxMidi <= 108,
    'register',
  );
  check(
    r.register.minSongRange > 0 && r.register.minSongRange <= r.register.maxSongRange,
    'register.range',
  );
  check(
    Number.isFinite(r.answer.registerShift) &&
      r.answer.registerShift >= 0 &&
      r.answer.registerShift <= 12,
    'answer.registerShift',
  );
  check(
    Number.isFinite(r.register.melodyLift) &&
      r.register.melodyLift >= 0 &&
      r.register.melodyLift <= 24,
    'register.melodyLift',
  );
  for (const [k, v] of Object.entries(r.rhythm))
    check(Number.isFinite(v) && v > 0 && v <= 1, `rhythm.${k}`);
  check(
    Number.isInteger(r.register.chordMax) &&
      r.register.chordMax >= r.register.minMidi + 12 &&
      r.register.chordMax <= r.register.maxMidi,
    'register.chordMax',
  );
  check(
    r.quote.accent > 0 &&
      r.quote.accent <= 1 &&
      r.quote.busyAccent > 0 &&
      r.quote.busyAccent <= r.quote.accent,
    'quote.accent',
  );
  check(
    Number.isInteger(r.quote.chordVoices) && r.quote.chordVoices >= 1 && r.quote.chordVoices <= 3,
    'quote.chordVoices',
  );
  check(r.ending.minRingSeconds > 0 && r.ending.minRingSeconds <= 4, 'ending');
  check(
    Number.isInteger(r.limits.maxNotes) && r.limits.maxNotes >= 100 && r.limits.maxNotes <= 4000,
    'maxNotes',
  );
  for (const [m, modes] of Object.entries(r.modeByMood))
    check(modes.length > 0 && modes.every((mode) => mode in BACKGROUND_RULES.modes), `modes.${m}`);
  for (const [m, p] of Object.entries(r.progressions))
    check(
      p.length > 0 && p.every((n) => Number.isInteger(n) && n >= 1 && n <= 7),
      `progression.${m}`,
    );
  return out;
}
/**
 * 换一换 cycles through this many versions (take 0 … 3): each starts the chord walk one chord later (the mood's four, or the
 * song's own), odd takes trade struck and broken chords, and the quoted phrases advance.
 */
export const TEXTBOOK_TAKES = 4;
/** The musical input, not display strings, determines the cache token. */
export function textbookIdentity(
  input: TextbookComposeInput,
  rules: TextbookRules = TEXTBOOK_RULES,
) {
  const t = input.textbook;
  return `textbook:${compositionToken(
    JSON.stringify({
      seconds: input.seconds,
      mood: input.mood,
      content: input.contentToken ?? null,
      textbook: [
        t.id,
        t.tempoBpm,
        t.meter,
        t.rhythmCell,
        t.mode,
        t.tonic ?? null,
        t.mood,
        t.onsetDensity,
        t.pitchRange.low,
        t.pitchRange.high,
        t.brightness,
        t.repetition,
        t.pulse ?? null,
        t.melody ?? null,
        t.extraction.numbers,
        t.extraction.words,
        t.extraction.confidence,
        t.extraction.earChecked,
      ],
      sounds: [...input.sounds]
        .sort((a, b) => a.start - b.start || a.eventId.localeCompare(b.eventId))
        .map((s) => [
          s.eventId,
          s.n,
          s.start,
          s.end,
          s.pitch,
          s.length,
          s.contour,
          s.intensity,
          s.pattern,
          s.kind,
          s.brightness,
          ['pitch', 'length', 'contour', 'intensity', 'pattern', 'kind', 'brightness'].map(
            (k) => s.sources?.[k as keyof NonNullable<TextbookSound['sources']>] ?? 'unknown',
          ),
        ]),
      rules,
      mix: MIX_RULES.version,
      // Only 换一换 sets a take; the first version keeps the token it always had.
      ...(input.take ? { take: input.take } : {}),
    }),
  )}`;
}
export function composeTextbook(
  input: TextbookComposeInput,
  rules: TextbookRules = TEXTBOOK_RULES,
): TextbookComposition {
  if (textbookRuleProblems(rules).length) throw new Error('invalid-textbook-rules');
  if (!isTextbookComposeInput(input)) return { status: 'unavailable', reason: 'invalid-input' };
  const song = input.textbook;
  if (song.pulse === 'none') return { status: 'unavailable', reason: 'free-pulse' };
  if (song.extraction.confidence < rules.confidence.minimumTempo)
    return { status: 'unavailable', reason: 'unreliable-tempo' };
  const even = song.pulse === 'even' || song.extraction.confidence < rules.confidence.strongBeat;
  const hasRhythm = song.rhythmCell.length > 0;
  const identity = textbookIdentity(input, rules),
    portrait = textbookPortrait(input, rules),
    { beat, bar } = portrait;
  const colour = input.mood ?? song.mood,
    allowed = rules.modeByMood[colour];
  const mode = (
    input.mood ? (allowed.includes(song.mode) ? song.mode : allowed[0]!) : song.mode
  ) as TextbookMode;
  const feel = BACKGROUND_RULES.moods[colour];
  const tonic =
    song.tonic === undefined
      ? feel.tonic
      : feel.tonic + ((((song.tonic - feel.tonic + 18) % 12) + 12) % 12) - 6;
  const phrases = song.melody?.status === 'extracted' ? song.melody.phrases : [];
  // The song's own chords where its melody was extracted; otherwise the mood's.
  const progression = (phrases.length &&
    songProgression(phrases, song.meter, BACKGROUND_RULES.modes[mode].scale, tonic)) || [
    ...rules.progressions[colour],
  ];
  /** 换一换: another version from the same song and sounds. Take 0 is the first version, unchanged. */
  const take = input.take ?? 0;
  const sounds = [...input.sounds].sort(
    (a, b) => a.start - b.start || a.eventId.localeCompare(b.eventId),
  );
  const known = (key: keyof NonNullable<TextbookSound['sources']>) =>
    sounds.filter((s) => knownFeature(s, key));
  const majority = (key: 'length' | 'pattern', value: string) => {
    const list = known(key);
    return list.length > 0 && list.filter((s) => s[key] === value).length > list.length / 2;
  };
  const long = majority('length', 'long'),
    short = majority('length', 'short');
  const noteBeats = long
    ? rules.answer.longBeats
    : short
      ? rules.answer.shortBeats
      : rules.answer.mediumBeats;
  const contours = known('contour').map((s) => s.contour);
  const contour = (['rising', 'falling', 'flat', 'wavy'] as const).reduce<TextbookSound['contour']>(
    (best, c) =>
      contours.filter((v) => v === c).length > contours.filter((v) => v === best).length ? c : best,
    null,
  );
  const direction = contour === 'falling' ? -1 : 1;
  const motifDegrees = Array.from({ length: rules.answer.motifNotes }, (_, i) =>
    contour === 'flat' ? i % 2 : contour === 'wavy' ? [0, 2, 1, 3, 2, 0][i]! : i * direction,
  );
  // Original cell is continuous: never stretch it or restart it at each bar boundary.
  const cell = even || !hasRhythm ? [1] : song.rhythmCell;
  const rhythmOnsets: { at: number; beats: number }[] = [];
  for (let at = 0, i = 0; at < input.seconds - 1e-9; i++) {
    const beats = cell[i % cell.length]!;
    rhythmOnsets.push({ at, beats });
    at += beats * beat;
  }
  const sections: TextbookProgramPlan['sections'] = portrait.sections.map((s) => {
    const local = sounds.filter((sound) => sound.start < s.end && sound.end > s.start);
    const texture = local.some(
      (sound) =>
        (knownFeature(sound, 'kind') && sound.kind === 'texture') ||
        (knownFeature(sound, 'pattern') && sound.pattern === 'fade-in') ||
        (knownFeature(sound, 'length') && sound.length === 'long'),
    );
    const repeats =
      local.some((sound) => knownFeature(sound, 'pattern') && sound.pattern === 'repeat') ||
      new Set(local.map((sound) => sound.n)).size < local.length;
    const bursts = local.some(
      (sound) => knownFeature(sound, 'pattern') && sound.pattern === 'bursts',
    );
    return {
      startBar: s.startBar,
      endBar: s.endBar,
      density: s.density,
      pattern:
        s.density === 'busy' || texture
          ? 'pad'
          : repeats
            ? 'ostinato'
            : // An odd take trades struck chords and broken ones where the sounds leave the choice open.
              (bursts || song.onsetDensity === 'busy') !== (take % 2 === 1)
              ? 'arpeggio'
              : 'block',
      rhythm: s.density === 'busy' || even ? 'beats' : 'original',
      answer: s.density === 'busy' ? 'rest' : 'imitate',
      accent: s.density === 'busy' ? rules.rhythm.softAccent : rules.rhythm.mediumAccent,
    };
  });
  const motifBeats = motifRhythm(cell, motifDegrees.length, noteBeats, long);
  const plan: TextbookProgramPlan = {
    mode,
    tonic,
    progression,
    motif: { degrees: motifDegrees, beats: motifBeats },
    sections,
  };
  const scale = BACKGROUND_RULES.modes[mode].scale;
  const degreePitch = (degree: number) =>
    tonic + scale[((degree % 7) + 7) % 7]! + 12 * Math.floor(degree / 7);
  const cadenceAt =
    Math.max(0, Math.floor((input.seconds - rules.ending.minRingSeconds) / bar)) * bar;
  const musicOf = (notes: BackgroundNote[]): BackgroundPlan => ({
    rules: rules.version,
    mix: MIX_RULES.version,
    source: 'local-rules',
    seconds: input.seconds,
    tempo: song.tempoBpm,
    metre: song.meter,
    mode,
    tonic,
    colour,
    textbook: song.id,
    cadenceAt,
    fadeInSeconds: Math.min(rules.fade.inSeconds, input.seconds / 3),
    fadeOutSeconds: Math.min(rules.fade.outSeconds, input.seconds / 3),
    notes,
    duck: duckPoints(sounds, input.seconds),
  });
  // The song's phrases are placed first, so the chords under them can be the ones that fit them.
  const quoted = phrases.length ? arrangeTextbookMelody(input, musicOf([]), rules) : null;
  const barChords = quoted
    ? quotedBarChords(quoted.music.notes, bar, beat, scale, tonic)
    : new Map<number, number>();
  const degreeAt = (at: number) => {
    const b = Math.floor(at / bar + 1e-7);
    if (at >= cadenceAt - 1e-9) return 1;
    if (cadenceAt >= 2 * bar && b === Math.round(cadenceAt / bar) - 1) return 5;
    const under = barChords.get(b);
    if (under) return under;
    const s = sections.find((s) => b >= s.startBar && b < s.endBar)!;
    const step = Math.floor(b / (s.density === 'busy' ? 2 : 1));
    // A later take walks the same chords from another point; the first bar still opens on the first chord.
    return progression[(step + (step > 0 ? take : 0)) % progression.length]!;
  };
  const triad = (at: number) => [0, 2, 4].map((step) => degreePitch(degreeAt(at) - 1 + step));
  const notes: BackgroundNote[] = [];
  const add = (
    at: number,
    length: number,
    midi: number,
    part: BackgroundNote['part'],
    accent: number,
  ) => {
    length = Math.min(length, input.seconds - at);
    if (length > 1e-6 && at >= 0 && at < input.seconds) {
      if (notes.length >= rules.limits.maxNotes) throw new Error('textbook-note-limit');
      notes.push({
        at,
        length,
        // Chords and bass sit below the tune, so the melody is heard on top even in one plain voice.
        midi:
          part === 'rhythm'
            ? 0
            : fitOctave(
                Math.round(midi),
                rules.register.minMidi,
                part === 'chord'
                  ? rules.register.chordMax
                  : part === 'bass'
                    ? rules.register.chordMax - 12
                    : rules.register.maxMidi,
              ),
        part,
        accent,
      });
    }
  };
  for (let b = 0; b < portrait.bars.length; b++) {
    const { start, end } = portrait.bars[b]!;
    if (start >= cadenceAt - 1e-9) break;
    const section = sections.find((s) => b >= s.startBar && b < s.endBar)!,
      // Where the song's tune is quoted, the chord thins (root and third) to leave the tune room on top.
      chord = triad(start).slice(0, barChords.has(b) ? rules.quote.chordVoices : 3),
      // …and is struck softly there.
      chordAccent = barChords.has(b) ? rules.rhythm.softAccent : section.accent;
    const onsets =
      section.rhythm === 'original'
        ? rhythmOnsets.filter((n) => n.at >= start - 1e-9 && n.at < end - 1e-9)
        : [];
    if (section.pattern === 'pad' || !onsets.length) {
      for (const midi of chord) add(start, end - start, midi, 'chord', 0);
    } else if (section.pattern === 'arpeggio' || section.pattern === 'ostinato') {
      onsets.forEach((n, i) =>
        add(
          n.at,
          Math.min(n.beats * beat * rules.rhythm.gate, end - n.at),
          chord[i % chord.length]!,
          'chord',
          chordAccent,
        ),
      );
    } else
      for (const n of onsets)
        for (const midi of chord)
          add(
            n.at,
            Math.min(n.beats * beat * rules.rhythm.gate, end - n.at),
            midi,
            'chord',
            chordAccent,
          );
    // A pitched voice carries the clock even without a selected drummer.
    for (let p = 0; p < song.meter; p++) {
      const at = start + p * beat;
      if (at >= Math.min(end, cadenceAt) - 1e-9) break;
      const pulse = even ? rules.rhythm.even : p === 0 ? rules.rhythm.strong : rules.rhythm.weak;
      const accent = section.density === 'busy' ? pulse * rules.rhythm.mediumAccent : pulse;
      add(at, beat * rules.rhythm.bassGate, chord[0]! - 12, 'bass', accent);
      add(at, beat * rules.rhythm.gate, 0, 'rhythm', accent);
    }
  }
  const margin = rules.answer.marginSeconds;
  const occupied = mergeSpans(
    sounds.map((s) => ({ start: s.start - margin, end: s.end + margin })),
    input.seconds,
  );
  const gaps: { start: number; end: number }[] = [];
  let from = 0;
  for (const span of [...occupied, { start: input.seconds, end: input.seconds }]) {
    if (span.start - from >= rules.answer.minGapBeats * beat)
      gaps.push({ start: from, end: Math.min(span.start, cadenceAt) });
    from = Math.max(from, span.end);
  }
  const pool = Array.from({ length: 49 }, (_, j) => degreePitch(j - 21)).filter(
    (n) => n >= rules.register.minMidi && n <= rules.register.maxMidi,
  );
  let phrase = 0;
  // With the song's phrases the tune is quoted from the song; the program's answer motif is only for feature-only songs.
  for (const gap of quoted ? [] : gaps) {
    const before = sounds
      .filter((s) => s.end <= gap.start + margin + 1e-9)
      .sort((a, b) => b.end - a.end)[0];
    const localLength = before && knownFeature(before, 'length') ? before.length : null;
    const limit =
      localLength === 'short'
        ? rules.answer.shortBeats
        : localLength === 'long'
          ? rules.answer.longBeats
          : noteBeats;
    const beats = motifRhythm(
      cell,
      motifDegrees.length,
      limit,
      localLength === 'long' || (localLength === null && long),
    );
    const duration = beats.reduce((sum, n) => sum + n, 0) * beat;
    let at = Math.ceil((gap.start - 1e-9) / beat) * beat;
    while (at + duration <= gap.end + 1e-9) {
      const section = sections.find((s) => at >= s.startBar * bar && at < s.endBar * bar);
      // Do not run a phrase into a following busy section.
      if (
        !section ||
        section.answer === 'rest' ||
        at + duration > Math.min(section.endBar * bar, gap.end) + 1e-9
      ) {
        at += beat;
        continue;
      }
      const pitch = before && knownFeature(before, 'pitch') ? before.pitch : null;
      const shift =
        pitch === 'high'
          ? -rules.answer.registerShift
          : pitch === 'low'
            ? rules.answer.registerShift
            : 0;
      const range = clamp(
        song.pitchRange.high - song.pitchRange.low,
        rules.register.minSongRange,
        rules.register.maxSongRange,
      );
      const variation = song.repetition === 'high' ? 0 : (phrase + take) % 2;
      for (let i = 0; i < motifDegrees.length; i++) {
        let d = motifDegrees[i]!;
        if (before && knownFeature(before, 'contour')) {
          if (before.contour === 'rising') d = i;
          else if (before.contour === 'falling') d = -i;
          else if (before.contour === 'flat') d = i % 2;
        }
        let midi = tonic + rules.register.melodyLift + shift + degreePitch(d + variation) - tonic;
        midi = clamp(
          midi,
          tonic + shift + rules.register.melodyLift - range / 2,
          tonic + shift + rules.register.melodyLift + range / 2,
        );
        midi = pool.reduce(
          (best, n) => (Math.abs(n - midi) < Math.abs(best - midi) ? n : best),
          pool[0]!,
        );
        const soft = before && knownFeature(before, 'intensity') && before.intensity === 'soft';
        add(
          at,
          beats[i]! * beat * rules.answer.notePortion,
          midi,
          'melody',
          soft ? rules.rhythm.softAccent : section.accent,
        );
        at += beats[i]! * beat;
      }
      phrase++;
      at += rules.answer.restBeats * beat;
    }
  }
  const final = triad(cadenceAt);
  for (const midi of final) add(cadenceAt, input.seconds - cadenceAt, midi, 'chord', 0);
  add(cadenceAt, input.seconds - cadenceAt, final[0]! - 12, 'bass', rules.rhythm.weak);
  if (quoted) {
    retreatUnderSounds(notes, sounds, rules);
    notes.push(...quoted.music.notes);
    if (notes.length > rules.limits.maxNotes) throw new Error('textbook-note-limit');
  }
  notes.sort((a, b) => a.at - b.at || a.part.localeCompare(b.part) || a.midi - b.midi);
  const arranged = { music: musicOf(notes), quotes: quoted?.quotes ?? [] };
  return {
    status: 'ready',
    version: TEXTBOOK_COMPOSE_VERSION,
    identity,
    maker: 'program',
    plan,
    music: arranged.music,
    quotes: arranged.quotes,
    portrait,
    facts: {
      metre: even ? 'internal' : 'known',
      rhythm: even || !hasRhythm ? 'beats' : 'song',
      earChecked: song.extraction.earChecked,
      brightness: 'not-applied',
      melody: arranged.quotes.length ? 'extracted' : 'feature-only',
    },
  };
}
