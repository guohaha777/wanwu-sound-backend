// AI background contract (background-request-v2): what the page sends when it asks the server for an AI background, and
// what comes back. The chain is AI music model (audio) → AI voice model (writes a composition plan) → AI text model
// (writes a composition plan) → the program composes alone in the browser → only the child's sounds. The plain
// background (local rules, AI off) needs none of this.
//
// The brief is an anonymous portrait of the child's piece: when each sound is heard and its features in words (高低、
// 长短、变化、轻响、出现方式, kind, brightness), the mood, which try this is and what the last AI background chose. It
// never holds recordings, sound names, people or places, and since v2 no textbook song: an AI background follows the
// child's piece only. The child's sounds and placement are never changed; a background is its own layer.
import { MOODS } from './arrangement.ts';
import type { MoodId } from './arrangement.ts';
import { SOUND_CHOICES, SOUND_KINDS } from './sound.ts';
import type {
  ContourChoice,
  DurationChoice,
  IntensityChoice,
  PatternChoice,
  PitchChoice,
  SoundKind,
} from './sound.ts';
import { DENSITIES, TEXTBOOK_MODES } from './textbook.ts';
import type { Density, Metre, TextbookMode, TextbookTrack } from './textbook.ts';

export const BACKGROUND_REQUEST_VERSION = 'background-request-v2' as const;

/**
 * Which step made a background: `audio-ai` the AI music model, `voice-ai` the AI voice model, `notes-ai` the AI text
 * model (both write a plan the server turns into notes), `program` the program alone when no AI step gave one, and
 * `local-rules` the plain background (AI off).
 */
export type BackgroundSource = 'audio-ai' | 'voice-ai' | 'notes-ai' | 'program' | 'local-rules';
export const BACKGROUND_SOURCES: readonly BackgroundSource[] = [
  'audio-ai',
  'voice-ai',
  'notes-ai',
  'program',
  'local-rules',
];
/** The steps the server may run, in the order they are tried. */
export type AiBackgroundStep = 'audio-ai' | 'voice-ai' | 'notes-ai';
export const AI_BACKGROUND_STEPS: readonly AiBackgroundStep[] = [
  'audio-ai',
  'voice-ai',
  'notes-ai',
];
/** Sources no model touched: they keep no prompt version. */
export const PROGRAM_SOURCES: readonly BackgroundSource[] = ['program', 'local-rules'];

/** Versions of every rule file a piece was made with, so the server can mix it again the same way. */
/** `orchestration` is absent on pieces saved before instrument arrangement had its own rules. */
export type RuleVersions = {
  analysis: string;
  shaping: string;
  background: string;
  mix: string;
  orchestration?: string;
};

/** Only the textbook song's features — never its audio, score or melody (textbook talk and the plain background). */
export type TextbookFeatures = Pick<
  TextbookTrack,
  | 'id'
  | 'tempoBpm'
  | 'meter'
  | 'rhythmCell'
  | 'onsetDensity'
  | 'pitchRange'
  | 'brightness'
  | 'mode'
  | 'repetition'
  | 'mood'
  | 'tonic'
>;

export type Brightness = 'dark' | 'mid' | 'bright';
export const BRIGHTNESSES: readonly Brightness[] = ['dark', 'mid', 'bright'];
/**
 * One placed sound as the composer hears it: its number (声音1, 声音2 … by first appearance, the same sound keeps its
 * number), when it is heard, and its features — the child's choice where made, else what the 声音体检 measured.
 * `contour` is null when the child did not choose one (the recording's own shape is not measured).
 */
export type BriefSound = {
  n: number;
  start: number;
  end: number;
  pitch: PitchChoice;
  length: DurationChoice;
  contour: ContourChoice | null;
  intensity: IntensityChoice;
  pattern: PatternChoice;
  kind: SoundKind;
  brightness: Brightness;
};

export type BackgroundBrief = {
  version: typeof BACKGROUND_REQUEST_VERSION;
  /** Lets the server cache per work; carries nothing about the child. */
  workId: string;
  /** Optional content token for the placed sources and their excerpts; no raw source ids or recordings. */
  identity?: string;
  /** The piece's real length; the background must not be longer. */
  seconds: number;
  mood: MoodId | null;
  /** Every placed sound, in time order. */
  sounds: BriefSound[];
  /** 0 for the first AI background of this piece, then 1, 2 … for each 换一首. */
  attempt: number;
  /** What the last AI background of this piece chose, so the next one differs; null the first time. */
  previous: ComposePlan | null;
  /** Instrument ids the child chose (who plays the notes); [] = the original soft voice. */
  instruments: string[];
  rules: RuleVersions;
};

// ----- the composition plan: what a model (or the program) chooses; the program writes the notes from it -----
export type ComposePattern = 'block' | 'arpeggio' | 'ostinato' | 'offbeat' | 'pad';
export const COMPOSE_PATTERNS: readonly ComposePattern[] = [
  'block',
  'arpeggio',
  'ostinato',
  'offbeat',
  'pad',
];
export type ComposeBass = 'none' | 'hold' | 'pulse' | 'walk' | 'ostinato';
export const COMPOSE_BASS: readonly ComposeBass[] = ['none', 'hold', 'pulse', 'walk', 'ostinato'];
export type ComposeDrums = 'none' | 'heartbeat' | 'march' | 'skip' | 'waltz' | 'groove';
export const COMPOSE_DRUMS: readonly ComposeDrums[] = [
  'none',
  'heartbeat',
  'march',
  'skip',
  'waltz',
  'groove',
];
/** How the melody answers the sound before each gap: follow its way (`imitate`) or answer the other way (`mirror`). */
export type ComposeAnswer = 'imitate' | 'mirror';
export const COMPOSE_ANSWERS: readonly ComposeAnswer[] = ['imitate', 'mirror'];
export type SectionRegister = 'low' | 'mid' | 'high';
export const SECTION_REGISTERS: readonly SectionRegister[] = ['low', 'mid', 'high'];
export type Dynamics = 'soft' | 'medium' | 'loud';
export const DYNAMICS: readonly Dynamics[] = ['soft', 'medium', 'loud'];
export type ComposeSection = { density: Density; register: SectionRegister; dynamics: Dynamics };
export type ComposePlan = {
  tempo: number;
  metre: Metre;
  mode: TextbookMode;
  /** Semitones from the mood's key centre. */
  tonicShift: number;
  /** One or two chord progressions as scale degrees ("1-5-6-4"); the second, when given, plays in the second half. */
  progressions: string[];
  pattern: ComposePattern;
  bass: ComposeBass;
  drums: ComposeDrums;
  /** The motif: scale degrees (0 = tonic) and beats, one each. */
  motif: { degrees: number[]; beats: number[] };
  answer: ComposeAnswer;
  /** 开头、发展、变化、收尾. */
  sections: ComposeSection[];
  /** The style card it was written to (an id from the ai-compose rules). */
  style: string;
};

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const oneOf = <T>(list: readonly T[], value: unknown): value is T => list.includes(value as T);
const PARTS = ['chord', 'bass', 'melody', 'rhythm'];

/** A plan in the right shape (values in range are the composer rules' job: they clamp and repair). */
export function isComposePlan(value: unknown): value is ComposePlan {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  const motif = raw.motif as Record<string, unknown> | null;
  return (
    finite(raw.tempo) &&
    oneOf([2, 3, 4], raw.metre) &&
    oneOf(TEXTBOOK_MODES, raw.mode) &&
    finite(raw.tonicShift) &&
    Array.isArray(raw.progressions) &&
    raw.progressions.length >= 1 &&
    raw.progressions.length <= 2 &&
    raw.progressions.every(
      (item) => typeof item === 'string' && /^[1-7](-[1-7]){1,7}$/.test(item),
    ) &&
    oneOf(COMPOSE_PATTERNS, raw.pattern) &&
    oneOf(COMPOSE_BASS, raw.bass) &&
    oneOf(COMPOSE_DRUMS, raw.drums) &&
    !!motif &&
    Array.isArray(motif.degrees) &&
    Array.isArray(motif.beats) &&
    motif.degrees.length >= 2 &&
    motif.degrees.length === motif.beats.length &&
    motif.degrees.every(finite) &&
    motif.beats.every(finite) &&
    oneOf(COMPOSE_ANSWERS, raw.answer) &&
    Array.isArray(raw.sections) &&
    raw.sections.length === 4 &&
    raw.sections.every(
      (section) =>
        section &&
        oneOf(DENSITIES, section.density) &&
        oneOf(SECTION_REGISTERS, section.register) &&
        oneOf(DYNAMICS, section.dynamics),
    ) &&
    nonEmpty(raw.style)
  );
}

const isBriefSound = (value: unknown): value is BriefSound => {
  if (!value || typeof value !== 'object') return false;
  const sound = value as Record<string, unknown>;
  return (
    Number.isInteger(sound.n) &&
    (sound.n as number) >= 1 &&
    finite(sound.start) &&
    finite(sound.end) &&
    (sound.end as number) >= (sound.start as number) &&
    oneOf(SOUND_CHOICES.pitch, sound.pitch) &&
    oneOf(SOUND_CHOICES.duration, sound.length) &&
    (sound.contour === null || oneOf(SOUND_CHOICES.contour, sound.contour)) &&
    oneOf(SOUND_CHOICES.intensity, sound.intensity) &&
    oneOf(SOUND_CHOICES.pattern, sound.pattern) &&
    oneOf(SOUND_KINDS, sound.kind) &&
    oneOf(BRIGHTNESSES, sound.brightness)
  );
};

export function isBackgroundBrief(value: unknown): value is BackgroundBrief {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== BACKGROUND_REQUEST_VERSION ||
    !nonEmpty(raw.workId) ||
    !finite(raw.seconds) ||
    raw.seconds <= 0
  )
    return false;
  if (
    raw.identity !== undefined &&
    (typeof raw.identity !== 'string' || !/^ai:[a-f0-9]{16}$/.test(raw.identity))
  )
    return false;
  if (
    !Array.isArray(raw.sounds) ||
    !raw.sounds.length ||
    raw.sounds.length > 64 ||
    !raw.sounds.every(isBriefSound)
  )
    return false;
  if (raw.mood !== null && !MOODS.includes(raw.mood as MoodId)) return false;
  if (!Number.isInteger(raw.attempt) || (raw.attempt as number) < 0 || (raw.attempt as number) > 99)
    return false;
  if (raw.previous !== null && !isComposePlan(raw.previous)) return false;
  if (!Array.isArray(raw.instruments) || !raw.instruments.every(nonEmpty)) return false;
  const rules = raw.rules as Record<string, unknown> | null;
  return (
    !!rules && ['analysis', 'shaping', 'background', 'mix'].every((key) => nonEmpty(rules[key]))
  );
}

/** One note of a composed background, already written and checked with the shared rules. */
export type BackgroundNoteData = {
  at: number;
  length: number;
  midi: number;
  part: 'chord' | 'bass' | 'melody' | 'rhythm';
  accent: number;
};
export type BackgroundUnavailable = 'not-open' | 'offline' | 'quota' | 'timeout' | 'failed';
export type BackgroundResult =
  | {
      status: 'ready';
      source: 'audio-ai';
      audioUrl: string;
      durationMs: number;
      model: string;
      promptVersion: string;
    }
  | {
      status: 'ready';
      source: 'voice-ai' | 'notes-ai';
      notes: BackgroundNoteData[];
      plan: ComposePlan;
      model: string;
      promptVersion: string;
    }
  | { status: 'unavailable'; reason: BackgroundUnavailable };
export const BACKGROUND_UNAVAILABLE: readonly BackgroundUnavailable[] = [
  'not-open',
  'offline',
  'quota',
  'timeout',
  'failed',
];

/** Every note inside the piece, with a real pitch, a known part and an accent of 0–1. */
export const validNotes = (notes: unknown, seconds: number) =>
  Array.isArray(notes) &&
  notes.length > 0 &&
  notes.every(
    (note) =>
      note &&
      finite(note.at) &&
      note.at >= 0 &&
      finite(note.length) &&
      note.length > 0 &&
      note.at + note.length <= seconds + 1e-6 &&
      Number.isInteger(note.midi) &&
      PARTS.includes(note.part) &&
      finite(note.accent) &&
      note.accent >= 0 &&
      note.accent <= 1,
  );

/**
 * 作品留住的背景: the composed background a saved piece keeps (AI 作曲 or 程序自编) — the notes the child heard and the
 * frame they were written in — so the shelf, the server and 音乐小发现 play that music instead of rebuilding the plain
 * one. Absent on pieces saved before 2026-11-01 and for an AI audio file (its link does not last): those play the
 * local background as before.
 */
export type KeptBackground = {
  tempo: number;
  metre: Metre;
  mode: TextbookMode;
  /** MIDI note of the key centre. */
  tonic: number;
  /** Where the tonic lands for the ending, in seconds. */
  cadenceAt: number;
  notes: BackgroundNoteData[];
};
/** The longest piece is 45 s chosen + 5 s overrun; no kept note may ring past this. */
const KEPT_SECONDS_MAX = 60;
export const KEPT_NOTES_MAX = 4000;
export function isKeptBackground(value: unknown): value is KeptBackground {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return (
    finite(raw.tempo) &&
    raw.tempo > 0 &&
    oneOf([2, 3, 4], raw.metre) &&
    oneOf(TEXTBOOK_MODES, raw.mode) &&
    finite(raw.tonic) &&
    finite(raw.cadenceAt) &&
    raw.cadenceAt >= 0 &&
    Array.isArray(raw.notes) &&
    raw.notes.length <= KEPT_NOTES_MAX &&
    validNotes(raw.notes, KEPT_SECONDS_MAX)
  );
}

/** Validates what the server sends back before the page plays it. */
export function parseBackgroundResult(value: unknown, seconds: number): BackgroundResult | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.status === 'unavailable')
    return BACKGROUND_UNAVAILABLE.includes(raw.reason as BackgroundUnavailable)
      ? (raw as BackgroundResult)
      : null;
  if (raw.status !== 'ready' || !nonEmpty(raw.model) || !nonEmpty(raw.promptVersion)) return null;
  if (raw.source === 'audio-ai') {
    const url = raw.audioUrl;
    // An https file, no longer than the piece (half a second of slack).
    return nonEmpty(url) &&
      /^https:\/\//.test(url) &&
      finite(raw.durationMs) &&
      raw.durationMs > 0 &&
      raw.durationMs <= seconds * 1000 + 500
      ? (raw as BackgroundResult)
      : null;
  }
  if (raw.source === 'voice-ai' || raw.source === 'notes-ai')
    return validNotes(raw.notes, seconds) && isComposePlan(raw.plan)
      ? (raw as BackgroundResult)
      : null;
  return null;
}
