// Every melody note in this path comes from an extracted source phrase, with explicit transforms.
import type { TextbookComposeInput, TextbookSound } from '@wanwu-v2/contracts/textbook-compose';
import type { MelodyPhrase } from '@wanwu-v2/contracts/textbook-melody';
import type { BackgroundPlan, BackgroundNote } from './background.ts';
import { BACKGROUND_RULES } from './rules.ts';
import { mergeSpans } from './mix.ts';
import { knownFeature } from './textbookPortrait.ts';
import type { TextbookRules } from './textbookPortrait.ts';
export type TextbookQuote = {
  phraseId: string;
  at: number;
  sourceNotes: number[];
  transform: ('mode-fit' | 'octave' | 'retrograde' | 'fragment')[];
};
export function arrangeTextbookMelody(
  input: TextbookComposeInput,
  base: BackgroundPlan,
  rules: TextbookRules,
): { music: BackgroundPlan; quotes: TextbookQuote[] } {
  const melody = input.textbook.melody;
  const phrases = melody?.status === 'extracted' ? melody.phrases : [];
  if (!phrases.length) return { music: base, quotes: [] };
  const beat = 60 / base.tempo,
    bar = beat * base.metre,
    margin = rules.answer.marginSeconds;
  const sounds = [...input.sounds].sort((a, b) => a.start - b.start || a.n - b.n);
  const occupied = mergeSpans(
    sounds.map((s) => ({ start: s.start - margin, end: s.end + margin })),
    base.seconds,
  );
  const windows: { start: number; end: number; busy: boolean }[] = [];
  let from = 0;
  for (const span of [...occupied, { start: base.cadenceAt, end: base.cadenceAt }]) {
    const end = Math.min(span.start, base.cadenceAt);
    if (end - from >= rules.answer.minGapBeats * beat)
      windows.push({ start: from, end, busy: false });
    from = Math.max(from, span.end);
  }
  // Where no gap can hold a phrase, a quiet source fragment can carry the song underneath the child's layer.
  for (let start = 0; start < base.cadenceAt - 1e-9; start += bar * rules.sectionBars) {
    const end = Math.min(start + bar * rules.sectionBars, base.cadenceAt);
    if (windows.some((w) => w.start < end && w.end > start)) continue;
    const beats = Array.from(
      { length: Math.max(1, Math.floor((end - start) / beat)) },
      (_, i) => start + i * beat,
    );
    const weight = (at: number) =>
      sounds
        .filter((s) => s.start <= at && s.end > at)
        .reduce((sum, s) => sum + (s.intensity === 'loud' ? 2 : 1), 0);
    const at = beats.reduce((best, t) => (weight(t) < weight(best) ? t : best), beats[0]!);
    windows.push({ start: at, end, busy: true });
  }
  windows.sort((a, b) => a.start - b.start);
  const notes: BackgroundNote[] = base.notes
    .filter((n) => n.part !== 'melody')
    .map((n) => ({ ...n }));
  const quotes: TextbookQuote[] = [];
  const sourceContour = (p: MelodyPhrase) => Math.sign(p.notes.at(-1)!.midi - p.notes[0]!.midi);
  const choose = (before: TextbookSound | undefined, seconds: number, ordinal: number) => {
    const wanted =
      before && knownFeature(before, 'contour')
        ? before.contour === 'rising'
          ? 1
          : before.contour === 'falling'
            ? -1
            : 0
        : 0;
    const same = phrases.filter((p) => !wanted || sourceContour(p) === wanted);
    const pool = same.length ? same : phrases;
    // The same recurring child sound reuses a related source phrase; later distinct sounds advance through the source.
    const start = (before ? before.n - 1 : ordinal) % pool.length;
    const candidates = Array.from(
      { length: pool.length },
      (_, i) => pool[(start + i) % pool.length]!,
    );
    return candidates.find((p) => (p.endBeat - p.startBeat) * beat <= seconds) ?? candidates[0]!;
  };
  let ordinal = 0;
  for (const window of windows) {
    let at = Math.ceil((window.start - 1e-9) / beat) * beat;
    while (at + beat <= window.end + 1e-9) {
      const before =
        sounds.filter((s) => s.end <= at + margin).sort((a, b) => b.end - a.end)[0] ??
        sounds.filter((s) => s.start <= at && s.end > at).sort((a, b) => b.start - a.start)[0];
      const phrase = choose(before, window.end - at, ordinal++);
      const transform: TextbookQuote['transform'] = [];
      let indexed = phrase.notes.map((n, i) => ({ n, i }));
      if (
        before &&
        knownFeature(before, 'contour') &&
        before.contour === 'falling' &&
        sourceContour(phrase) > 0
      ) {
        indexed.reverse();
        transform.push('retrograde');
      }
      const referenceStart = indexed[0]!.n.atBeat;
      // Reversing a phrase retains the original note durations and rest lengths in reverse order.
      const timeline = indexed.map(({ n, i }) => ({
        n,
        i,
        offset: transform.includes('retrograde')
          ? phrase.endBeat - n.atBeat - n.beats
          : n.atBeat - referenceStart,
      }));
      const maxNotes = window.busy ? rules.quote.busyNotes : timeline.length;
      const available = timeline
        .slice(0, maxNotes)
        .filter((item) => at + (item.offset + item.n.beats) * beat <= window.end + 1e-9);
      if (available.length < rules.quote.minNotes) {
        at += beat;
        continue;
      }
      if (available.length < timeline.length) transform.push('fragment');
      const pitch = before && knownFeature(before, 'pitch') ? before.pitch : null;
      const mean = available.reduce((sum, item) => sum + item.n.midi, 0) / available.length;
      let octave =
        pitch === 'high' && mean >= rules.quote.highRegister
          ? -12
          : pitch === 'low' && mean < rules.quote.highRegister
            ? 12
            : 0;
      if (
        available.some(
          (item) =>
            item.n.midi + octave < rules.register.minMidi ||
            item.n.midi + octave > rules.register.maxMidi,
        )
      )
        octave = 0;
      if (octave) transform.push('octave');
      const modeChanged = base.mode !== input.textbook.mode;
      if (modeChanged) transform.push('mode-fit');
      const scale = BACKGROUND_RULES.modes[base.mode].scale;
      const pool = Array.from(
        { length: rules.register.maxMidi - rules.register.minMidi + 1 },
        (_, i) => rules.register.minMidi + i,
      ).filter((m) => scale.includes((((m - base.tonic) % 12) + 12) % 12));
      for (const item of available) {
        let midi = item.n.midi + octave;
        if (modeChanged)
          midi = pool.reduce(
            (best, n) => (Math.abs(n - midi) < Math.abs(best - midi) ? n : best),
            pool[0]!,
          );
        const accent = window.busy
          ? rules.rhythm.softAccent
          : before?.intensity === 'soft'
            ? rules.rhythm.softAccent
            : rules.rhythm.mediumAccent;
        notes.push({
          at: at + item.offset * beat,
          length: item.n.beats * beat * rules.answer.notePortion,
          midi,
          part: 'melody',
          accent,
        });
      }
      quotes.push({
        phraseId: phrase.id,
        at,
        sourceNotes: available.map((item) => item.i),
        transform,
      });
      at += (available.at(-1)!.offset + available.at(-1)!.n.beats + rules.answer.restBeats) * beat;
      if (window.busy) break;
    }
  }
  // Local overlap/entry changes alter the actual dynamics, not a cache id or arbitrary random seed.
  for (const note of notes) {
    const active = sounds.filter((s) => s.start <= note.at && s.end > note.at);
    if (active.length > 1) note.accent /= 1 + (active.length - 1) * rules.quote.overlapRetreat;
  }
  notes.sort((a, b) => a.at - b.at || a.part.localeCompare(b.part) || a.midi - b.midi);
  if (notes.length > rules.limits.maxNotes) throw new Error('textbook-note-limit');
  return { music: { ...base, notes }, quotes };
}
