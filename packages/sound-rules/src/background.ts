// The local background (本地动态音符): the offline step of the background chain (AI audio → AI notes → this → only
// the child's sounds). From the piece's length, when the child's sounds play, the mood and an optional textbook card
// it writes the notes of a soft accompaniment — no model, no network, and the same work always gets the same notes.
// - Colour (调式、和弦、音区、疏密) comes from the child's mood; without one, from the textbook song; else neutral.
// - Rhythm (速度、拍子、旋律的节奏) comes from the textbook song when one is chosen; else from the mood.
// - Chords and bass are always there; the melody only plays in the gaps between the child's sounds (一问一答).
// - The ending stays inside the piece's length: the chord before is the dominant, then the tonic lands on the last
//   bar line that leaves room to ring, and holds to the end.
// - While a child's sound plays, the whole background makes room (see mix.ts).
// Who plays which part is decided separately (assignParts), so instruments never change the notes.
// Pure; the web renders the plan, a later server can render the same plan.
import type { MoodId } from '@wanwu-v2/contracts/arrangement';
import type { TextbookTrack } from '@wanwu-v2/contracts/textbook';
import { duckPoints, mergeSpans } from './mix.ts';
import type { GainPoint, Span } from './mix.ts';
import { seeded } from './random.ts';
import { BACKGROUND_RULES, MIX_RULES } from './rules.ts';
import type { BackgroundMode, BackgroundRules, MixRules } from './rules.ts';

export type { Span } from './mix.ts';
/** A child's sound in the piece: when it is heard and, when known, how it sounds (the five choices, or 声音体检 for 高低). */
export type SoundingSpan = Span & {
  pitch?: 'low' | 'mid' | 'high';
  contour?: 'rising' | 'falling' | 'flat' | 'wavy';
  intensity?: 'soft' | 'medium' | 'loud';
};
export type BackgroundPart = 'chord' | 'bass' | 'melody' | 'rhythm';
export const BACKGROUND_PARTS: readonly BackgroundPart[] = ['chord', 'bass', 'melody', 'rhythm'];
/** `accent` 0–1: how strongly the note is played. */
export type BackgroundNote = {
  at: number;
  length: number;
  midi: number;
  part: BackgroundPart;
  accent: number;
};
/** What the background borrows from a textbook card. */
export type BackgroundTextbook = Pick<
  TextbookTrack,
  'id' | 'tempoBpm' | 'meter' | 'rhythmCell' | 'mode' | 'mood' | 'tonic'
>;
export type BackgroundInput = {
  /** The piece's real length (the chosen length, or longer when a sound runs past it). The background never adds to it. */
  seconds: number;
  /** When the child's sounds are heard (and how they sound, which the melody answers). */
  sounding: readonly SoundingSpan[];
  mood: MoodId | null;
  textbook: BackgroundTextbook | null;
  /** The work's id: the same work always gets the same melody. */
  seed: string;
};
export type BackgroundPlan = {
  rules: string;
  mix: string;
  /** Which step of the background chain made it; the page says so. */
  source: 'local-rules';
  seconds: number;
  tempo: number;
  metre: 2 | 3 | 4;
  mode: BackgroundMode;
  tonic: number;
  /** Whose colour it has: the child's mood, the textbook song's, or neutral. */
  colour: MoodId | 'none';
  textbook: string | null;
  /** Where the tonic lands for the ending, in seconds. */
  cadenceAt: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  notes: BackgroundNote[];
  /** 背景让一让: gain points under the child's sounds. */
  duck: GainPoint[];
};

const near = (value: number, step: number) =>
  Math.abs(value / step - Math.round(value / step)) < 1e-6;

export function backgroundPlan(
  input: BackgroundInput,
  rules: BackgroundRules = BACKGROUND_RULES,
  mix: MixRules = MIX_RULES,
): BackgroundPlan {
  const { seconds, textbook } = input;
  const song = rules.song;
  /** A 0–1 switch in the rule file: on from one half. */
  const on = (value: number) => value >= 0.5;
  const colour: MoodId | 'none' = input.mood ?? textbook?.mood ?? 'none';
  const feel = rules.moods[colour];
  // Major or minor stays the child's mood when one is chosen (the song's otherwise); with keyFollow the key centre is the
  // song's, moved into the mood's register, so two songs of one mood still sound in their own keys.
  const keyFromSong = !!textbook && on(song.keyFollow);
  const mode: BackgroundMode = input.mood ? feel.mode : (textbook?.mode ?? feel.mode);
  const { scale, melody: melodySteps } = rules.modes[mode];
  const tempo = textbook?.tempoBpm ?? feel.tempo;
  const metre = textbook?.meter ?? feel.metre;
  // The song's key centre, moved to within half an octave of the mood's.
  const songTonic =
    keyFromSong && textbook?.tonic !== undefined
      ? feel.tonic + ((((textbook.tonic - feel.tonic) % 12) + 18) % 12) - 6
      : null;
  const beat = 60 / tempo;
  const bar = beat * metre;
  const tonic = songTonic ?? feel.tonic;
  const notes: BackgroundNote[] = [];
  // The song's rhythm cell, as it is; every layer that follows the song plays it.
  const songCell = textbook?.rhythmCell.length ? textbook.rhythmCell : null;
  /** The song's rhythm repeated from the start up to `until`: where each note of it falls. */
  const songOnsets = (until: number) => {
    const out: { at: number; length: number }[] = [];
    if (!songCell) return out;
    for (let t = 0, i = 0; t < until - 1e-9; i++) {
      const length = songCell[i % songCell.length]! * beat;
      out.push({ at: t, length });
      t += length;
    }
    return out;
  };

  // ----- harmony: one chord per bar, dominant then tonic at the end -----
  const pitch = (index: number) =>
    tonic + scale[((index % 7) + 7) % 7]! + 12 * Math.floor(index / 7);
  /** Triad on a scale degree (1–7), kept near the tonic: degrees above a fifth sit below it. */
  const triad = (degree: number) => {
    const root = degree - 1;
    const notes = [root, root + 2, root + 4].map(pitch);
    return scale[root]! > 6 ? notes.map((note) => note - 12) : notes;
  };
  // The last bar that still leaves minRingSeconds to ring is where the tonic lands.
  const cadenceBar = Math.max(0, Math.floor((seconds - rules.ending.minRingSeconds) / bar + 1e-9));
  const cadenceAt = cadenceBar * bar;
  /** The chord of a bar: the tonic from the cadence on, the dominant just before it, else the mood's progression. */
  const degreeOf = (barIndex: number) =>
    barIndex >= cadenceBar
      ? 1
      : barIndex === cadenceBar - 1 && cadenceBar >= 2
        ? 5
        : feel.progression[barIndex % feel.progression.length]!;
  // With a song, chords are struck on its rhythm and the bass on the rhythm's notes that fall on a beat (so the song's
  // pattern is heard all the time, not only in the gaps); the final chord still rings to the end.
  const onsets = songOnsets(cadenceAt);
  const chordsFollow = !!songCell && on(song.chordsFollow);
  const bassFollow = !!songCell && on(song.bassFollow);
  for (let i = 0; i <= cadenceBar; i++) {
    const at = i * bar;
    const end = i < cadenceBar ? Math.min(seconds, at + bar) : seconds;
    if (end <= at) break;
    const chord = triad(degreeOf(i));
    const inBar = onsets.filter((onset) => onset.at >= at - 1e-9 && onset.at < end - 1e-9);
    const last = i === cadenceBar;
    // Chords: struck on the song's rhythm, or held through the bar.
    if (chordsFollow && !last && inBar.length)
      for (const onset of inBar)
        for (const midi of chord)
          notes.push({
            at: onset.at,
            length: Math.min(onset.length * song.chordLengthPortion, end - onset.at),
            midi,
            part: 'chord',
            accent: near(onset.at, bar) ? 0.7 : 0.4,
          });
    else
      for (const midi of chord)
        notes.push({ at, length: end - at, midi, part: 'chord', accent: 0 });
    // Bass: the chord's root, on the song's notes that fall on a beat, or once per bar.
    const bassAt = bassFollow && !last ? inBar.filter((onset) => near(onset.at, beat)) : [];
    if (bassAt.length)
      for (const onset of bassAt)
        notes.push({
          at: onset.at,
          length: Math.min(onset.length, end - onset.at) * rules.bass.lengthPortion,
          midi: chord[0]! - rules.bass.dropSemitones,
          part: 'bass',
          accent: near(onset.at, bar) ? 0.8 : 0.5,
        });
    else
      notes.push({
        at,
        length: !last ? (end - at) * rules.bass.lengthPortion : end - at,
        midi: chord[0]! - rules.bass.dropSemitones,
        part: 'bass',
        accent: last ? 1 : 0.6,
      });
  }

  // ----- rhythm: every beat, strong and weak by the metre; one last stroke on the tonic -----
  const levels =
    metre === 2 ? rules.rhythm.two : metre === 3 ? rules.rhythm.three : rules.rhythm.four;
  // With a song (drumsFollow), the drum plays the song's rhythm: strong where it falls on a beat, lighter off the beat.
  if (songCell && on(song.drumsFollow)) {
    for (const onset of onsets) {
      const onBeat = near(onset.at, beat);
      const inBar = Math.round(onset.at / beat) % metre;
      notes.push({
        at: onset.at,
        length: Math.min(onset.length, seconds - onset.at),
        midi: 0,
        part: 'rhythm',
        accent: Math.min(
          1,
          onBeat
            ? levels[inBar]! + (inBar === 0 ? rules.rhythm.accentBoost * feel.accent : 0)
            : song.offbeatAccent,
        ),
      });
    }
    notes.push({
      at: cadenceAt,
      length: Math.min(beat, seconds - cadenceAt),
      midi: 0,
      part: 'rhythm',
      accent: 1,
    });
  } else
    for (let b = 0; b * beat < seconds - 1e-9; b++) {
      const at = b * beat;
      if (at > cadenceAt + 1e-9) break;
      const inBar = b % metre;
      const level = levels[inBar]! + (inBar === 0 ? rules.rhythm.accentBoost * feel.accent : 0);
      notes.push({
        at,
        length: Math.min(beat, seconds - at),
        midi: 0,
        part: 'rhythm',
        accent: Math.min(1, level),
      });
    }

  // ----- melody: only in the gaps between the child's sounds, long enough for a phrase -----
  const {
    liftSemitones,
    rangeSemitones,
    leapSteps,
    minGapBeats,
    marginSeconds,
    noteLengthPortion,
  } = rules.melody;
  const busy = mergeSpans(
    input.sounding.map((span) => ({
      start: span.start - marginSeconds,
      end: span.end + marginSeconds,
    })),
    seconds,
  );
  const gaps: Span[] = [];
  let from = 0;
  for (const span of [...busy, { start: seconds, end: seconds }]) {
    if (span.start - from >= minGapBeats * beat) gaps.push({ start: from, end: span.start });
    from = Math.max(from, span.end);
  }
  // 一问一答: the melody keeps out of the register most of the child's sounds use (higher sounds → a lower melody).
  const answer = rules.answer;
  const heights = input.sounding.map((span) =>
    span.pitch === 'high' ? 1 : span.pitch === 'low' ? -1 : 0,
  );
  const lean = heights.reduce((sum: number, h) => sum + h, 0);
  const known = heights.filter((h) => h !== 0).length;
  // Only when at least half of the sounds lean the same way.
  const away =
    known && Math.abs(lean) * 2 >= heights.length
      ? -Math.sign(lean) * answer.registerShiftSemitones
      : 0;
  const base = tonic + liftSemitones + away;
  // The notes the melody may use: the mode's melody steps over three octaves, within the range.
  const pool: number[] = [];
  for (let octave = 0; octave < 3; octave++)
    for (const step of melodySteps) {
      const midi = base + step + 12 * octave;
      if (midi <= base + rangeSemitones) pool.push(midi);
    }
  const random = seeded(input.seed);
  const cell = songCell ?? [feel.melodyEveryBeats];
  /** The note of the pool nearest to `midi` that belongs to the chord sounding at `at`. */
  const chordTone = (midi: number, at: number) => {
    const classes = new Set(
      triad(degreeOf(Math.floor(at / bar + 1e-9))).map((note) => ((note % 12) + 12) % 12),
    );
    return pool.reduce(
      (best, candidate) =>
        classes.has(candidate % 12) && Math.abs(candidate - midi) < Math.abs(best - midi)
          ? candidate
          : best,
      pool.find((candidate) => classes.has(candidate % 12)) ?? midi,
    );
  };
  let index = Math.floor(pool.length / 2);
  let t = 0;
  let step = 0;
  // The melody's rhythm runs on from the start; only the notes that fit in a gap are kept.
  const phrase: { at: number; length: number; gap: number }[] = [];
  while (t < cadenceAt - 1e-9) {
    const length = cell[step % cell.length]! * beat;
    const gap = gaps.findIndex(
      (item) =>
        t >= item.start - 1e-9 &&
        t + length * noteLengthPortion <= Math.min(item.end, cadenceAt) + 1e-9,
    );
    if (gap >= 0) phrase.push({ at: t, length: length * noteLengthPortion, gap });
    t += length;
    step++;
  }
  /** The child's sound just before a gap: its contour shapes the melody's answer in that gap, its loudness the accent. */
  const heardBefore = (gap: number) => {
    const at = gaps[gap]!.start;
    let last: SoundingSpan | null = null;
    for (const span of input.sounding)
      if (span.end <= at + marginSeconds + 1e-9 && (!last || span.end > last.end)) last = span;
    return last;
  };
  const asked = gaps.map((_, gap) => heardBefore(gap));
  let turn = 0;
  phrase.forEach((note, i) => {
    // A small step up or down, turning back at the edges of the range; after a child's sound with a chosen 走向 the steps
    // follow it: 往上走 rises, 往下落 falls, 稳稳的 stays close, 有起伏 goes up and down in turn.
    const contour = on(answer.followContour) ? asked[note.gap]?.contour : undefined;
    // A rising answer starts low in the range and a falling one high, so the whole phrase can travel that way.
    if (phrase[i - 1]?.gap !== note.gap && (contour === 'rising' || contour === 'falling'))
      index = Math.round((pool.length - 1) * (contour === 'rising' ? 0.2 : 0.8));
    const size =
      contour === 'flat' ? Math.floor(random() * 2) : 1 + Math.floor(random() * leapSteps);
    const up =
      contour === 'rising'
        ? true
        : contour === 'falling'
          ? false
          : contour === 'wavy' || contour === 'flat'
            ? turn++ % 2 === 0
            : random() < 0.5;
    const next = index + (up ? size : -size);
    index = next < 0 || next >= pool.length ? index + (up ? -size : size) : next;
    index = Math.min(pool.length - 1, Math.max(0, index));
    const downbeat = near(note.at, bar);
    const last = phrase[i + 1]?.gap !== note.gap;
    // On a downbeat and at the end of a phrase the melody sits on a chord note.
    const midi = downbeat || last ? chordTone(pool[index]!, note.at) : pool[index]!;
    index = pool.indexOf(midi);
    const loud = asked[note.gap]?.intensity;
    const lift =
      loud === 'loud' ? answer.intensityAccent : loud === 'soft' ? -answer.intensityAccent : 0;
    notes.push({
      at: note.at,
      length: note.length,
      midi,
      part: 'melody',
      accent: Math.max(0, Math.min(1, (downbeat ? 0.85 : 0.6) + lift)),
    });
  });
  // The melody lands on the tonic with the last chord, when no child's sound is there.
  if (
    gaps.some(
      (gap) =>
        cadenceAt >= gap.start - 1e-9 && Math.min(seconds, cadenceAt + beat) <= gap.end + 1e-9,
    )
  )
    notes.push({
      at: cadenceAt,
      length: seconds - cadenceAt,
      midi: base,
      part: 'melody',
      accent: 0.85,
    });

  return {
    rules: rules.version,
    mix: mix.version,
    source: 'local-rules',
    seconds,
    tempo,
    metre,
    mode,
    tonic,
    colour,
    textbook: textbook?.id ?? null,
    cadenceAt,
    fadeInSeconds: Math.min(rules.fade.inSeconds, seconds / 3),
    fadeOutSeconds: Math.min(
      rules.fade.outSeconds,
      seconds / 3,
      Math.max(rules.ending.minRingSeconds, seconds - cadenceAt),
    ),
    notes: notes.sort((a, b) => a.at - b.at),
    duck: duckPoints(input.sounding, seconds, mix),
  };
}

/** 万物声场's beat: what renderBackground needs, nothing else (no key, chords or colour). */
export type BeatPlan = Pick<
  BackgroundPlan,
  'rules' | 'seconds' | 'tempo' | 'metre' | 'fadeInSeconds' | 'fadeOutSeconds' | 'notes' | 'duck'
>;

/**
 * 万物声场 with a textbook song: only its beat — at the song's tempo and metre, the first beat of every bar strong and the
 * others light, from the start to the end of the piece, all on the rhythm part (a metronome plays it). No chords, key or
 * characteristic rhythm (the full background is 万物成曲's), and it does not make room under the child's sounds, so the
 * beat stays steady to place sounds against.
 */
export function beatPlan(
  { seconds, tempo, metre }: { seconds: number; tempo: number; metre: 2 | 3 | 4 },
  rules: BackgroundRules = BACKGROUND_RULES,
): BeatPlan {
  const beat = 60 / tempo;
  const { strong, weak } = rules.beat;
  const notes: BackgroundNote[] = [];
  for (let b = 0; b * beat < seconds - 1e-9; b++) {
    const at = b * beat;
    notes.push({
      at,
      length: Math.min(beat, seconds - at),
      midi: 0,
      part: 'rhythm',
      accent: b % metre === 0 ? strong : weak,
    });
  }
  // The first strong beat is heard at once; a short fade only so the last stroke does not click off.
  return {
    rules: rules.version,
    seconds,
    tempo,
    metre,
    fadeInSeconds: 0,
    fadeOutSeconds: Math.min(0.3, seconds / 3),
    notes,
    duck: [],
  };
}

/** What an instrument is for: parts it leads, and parts it can also cover when nobody leading them is chosen. */
export type PlayerRoles = {
  id: string;
  lead: readonly BackgroundPart[];
  can: readonly BackgroundPart[];
};
/** The background as generated: soft and plain, for the pitched parts nobody chosen can play. */
export const ORIGINAL_PLAYER = 'original';

/**
 * Who plays which part. Each part goes to the chosen instruments that lead it; if none does, to those that can play it;
 * a pitched part (chords, bass, melody) nobody chosen can play keeps the original soft voice. So nothing chosen = the
 * original background, and choosing only a drum adds its beat to the original, never leaves the drum alone.
 */
export function assignParts(chosen: readonly PlayerRoles[]): Record<BackgroundPart, string[]> {
  const parts = {} as Record<BackgroundPart, string[]>;
  for (const part of BACKGROUND_PARTS) {
    const lead = chosen.filter((player) => player.lead.includes(part));
    const can = chosen.filter((player) => player.can.includes(part));
    const players = (lead.length ? lead : can).map((player) => player.id);
    parts[part] = players.length || part === 'rhythm' ? players : [ORIGINAL_PLAYER];
  }
  return parts;
}

/**
 * 和我的声音碰一碰: what happened between the background and the child's sounds, in one of four words —
 * `together` (most sounds start on a beat: pushing together), `answer` (the melody comes back between sounds again and
 * again: call and answer), `fill` (the melody fills the gaps), `under` (no gap long enough: the background carries the
 * sounds). `example` is the first sound that started on a beat, for the explanation.
 */
export type Meeting = { kind: 'together' | 'answer' | 'fill' | 'under'; example: number | null };
export function backgroundMeeting(
  plan: Pick<BackgroundPlan, 'tempo' | 'notes'>,
  sounding: readonly Span[],
  rules: BackgroundRules = BACKGROUND_RULES,
): Meeting {
  const { toleranceSeconds, alignShare, answerTurns } = rules.meeting;
  const beat = 60 / plan.tempo;
  const onsets = sounding
    .map((span, index) => ({ at: span.start, index }))
    .sort((a, b) => a.at - b.at);
  const onBeat = onsets.filter(
    (onset) => Math.abs(onset.at - Math.round(onset.at / beat) * beat) <= toleranceSeconds,
  );
  const together = onsets.length > 0 && onBeat.length / onsets.length >= alignShare;
  const melody = plan.notes.filter((note) => note.part === 'melody');
  if (!melody.length)
    return { kind: together ? 'together' : 'under', example: onBeat[0]?.index ?? null };
  if (together) return { kind: 'together', example: onBeat[0]!.index };
  // Melody between two of the child's sounds counts as one answer.
  const spans = [...sounding].sort((a, b) => a.start - b.start);
  let turns = 0;
  for (let i = 0; i + 1 < spans.length; i++) {
    const from = spans[i]!.end;
    const to = spans[i + 1]!.start;
    if (melody.some((note) => note.at >= from - 1e-6 && note.at < to)) turns++;
  }
  return { kind: turns >= answerTurns ? 'answer' : 'fill', example: null };
}
