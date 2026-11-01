// Automatically transcribed melody: an estimate from the recording, never a human-verified score.
export const TEXTBOOK_MELODY_VERSION = 'textbook-melody-v1' as const;
export type MelodyNote = { atBeat: number; beats: number; midi: number; confidence: number };
export type MelodyPhrase = { id: string; startBeat: number; endBeat: number; notes: MelodyNote[] };
export type TextbookMelody = {
  version: typeof TEXTBOOK_MELODY_VERSION;
  source: 'basic-pitch';
  modelVersion: string;
  audioToken: string;
  status: 'extracted' | 'uncertain';
  excerptStart: number;
  excerptSeconds: number;
  tempo: number;
  /** First transcribed note offset within the excerpt, before beat normalization. */
  leadSeconds?: number;
  confidence: number;
  phrases: MelodyPhrase[];
};
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export function isTextbookMelody(v: unknown): v is TextbookMelody {
  if (!v || typeof v !== 'object') return false;
  const m = v as TextbookMelody;
  return (
    m.version === TEXTBOOK_MELODY_VERSION &&
    m.source === 'basic-pitch' &&
    typeof m.modelVersion === 'string' &&
    m.modelVersion.length > 0 &&
    typeof m.audioToken === 'string' &&
    /^[a-f0-9]{64}$/.test(m.audioToken) &&
    ['extracted', 'uncertain'].includes(m.status) &&
    finite(m.excerptStart) &&
    m.excerptStart >= 0 &&
    finite(m.excerptSeconds) &&
    m.excerptSeconds > 0 &&
    m.excerptSeconds <= 40 &&
    (m.leadSeconds === undefined ||
      (finite(m.leadSeconds) && m.leadSeconds >= 0 && m.leadSeconds < m.excerptSeconds)) &&
    finite(m.tempo) &&
    m.tempo >= 40 &&
    m.tempo <= 200 &&
    finite(m.confidence) &&
    m.confidence >= 0 &&
    m.confidence <= 1 &&
    Array.isArray(m.phrases) &&
    m.phrases.length <= 32 &&
    (m.status !== 'extracted' || m.phrases.length > 0) &&
    new Set(m.phrases.map((p) => p?.id)).size === m.phrases.length &&
    m.phrases.every(
      (p) =>
        p &&
        typeof p.id === 'string' &&
        p.id.length > 0 &&
        finite(p.startBeat) &&
        finite(p.endBeat) &&
        p.startBeat >= 0 &&
        p.endBeat > p.startBeat &&
        p.endBeat <= (m.excerptSeconds * m.tempo) / 60 + 1 &&
        Array.isArray(p.notes) &&
        p.notes.length >= 2 &&
        p.notes.length <= 64 &&
        p.notes.every(
          (n, i) =>
            n &&
            finite(n.atBeat) &&
            n.atBeat >= p.startBeat &&
            finite(n.beats) &&
            n.beats > 0 &&
            n.beats <= 8 &&
            n.atBeat + n.beats <= p.endBeat + 1e-6 &&
            (i === 0 || n.atBeat >= p.notes[i - 1]!.atBeat + p.notes[i - 1]!.beats - 1e-6) &&
            Number.isInteger(n.midi) &&
            n.midi >= 36 &&
            n.midi <= 96 &&
            finite(n.confidence) &&
            n.confidence >= 0 &&
            n.confidence <= 1,
        ),
    )
  );
}
