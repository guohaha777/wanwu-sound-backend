// Chords that follow the textbook song: each bar's triad is the one that holds most of the song's own melody there.
// Pure; the mood still decides the mode (and so which triads exist), never which song is heard.

/** Triads in the order a children's song reaches for them; a tie goes to the earlier one. */
const PREFERRED = [1, 4, 5, 6, 2, 3, 7] as const;

type Weighted = { midi: number; weight: number };

/** The scale degree (1–7) whose triad covers the most melody weight, or null when nothing sounds. */
export function chordFor(
  notes: readonly Weighted[],
  scale: readonly number[],
  tonic: number,
): number | null {
  let best: number | null = null,
    bestScore = 0;
  for (const degree of PREFERRED) {
    const triad = [0, 2, 4].map((step) => scale[(degree - 1 + step) % 7]!);
    let score = 0;
    for (const note of notes)
      if (triad.includes((((note.midi - tonic) % 12) + 12) % 12)) score += note.weight;
    if (score > bestScore + 1e-9) {
      best = degree;
      bestScore = score;
    }
  }
  return best;
}

/** Longer notes and notes on the bar's first beat weigh more. */
const weight = (beats: number, onDownbeat: boolean) => beats * (onDownbeat ? 1.5 : 1);

/**
 * The song's own chord walk, one triad per source bar of its extracted melody (a bar with no notes keeps the chord
 * before it); null when the melody has no notes. Used where no phrase of the song is quoted in the piece.
 */
export function songProgression(
  phrases: readonly { notes: readonly { atBeat: number; beats: number; midi: number }[] }[],
  metre: number,
  scale: readonly number[],
  tonic: number,
): number[] | null {
  const bars = new Map<number, Weighted[]>();
  for (const phrase of phrases)
    for (const note of phrase.notes) {
      const bar = Math.floor(note.atBeat / metre + 1e-9);
      const list = bars.get(bar) ?? [];
      list.push({
        midi: note.midi,
        weight: weight(note.beats, Math.abs(note.atBeat - bar * metre) < 1e-6),
      });
      bars.set(bar, list);
    }
  if (!bars.size) return null;
  const first = Math.min(...bars.keys()),
    last = Math.max(...bars.keys());
  const out: number[] = [];
  for (let bar = first, previous = 1; bar <= last; bar++) {
    previous = chordFor(bars.get(bar) ?? [], scale, tonic) ?? previous;
    out.push(previous);
  }
  return out;
}

/** For each bar of the piece that quotes the song: the triad under the quoted notes (bar index → degree). */
export function quotedBarChords(
  melody: readonly { at: number; length: number; midi: number }[],
  barSeconds: number,
  beatSeconds: number,
  scale: readonly number[],
  tonic: number,
): Map<number, number> {
  const bars = new Map<number, Weighted[]>();
  for (const note of melody) {
    const bar = Math.floor(note.at / barSeconds + 1e-7);
    const list = bars.get(bar) ?? [];
    list.push({
      midi: note.midi,
      weight: weight(note.length / beatSeconds, Math.abs(note.at - bar * barSeconds) < 1e-6),
    });
    bars.set(bar, list);
  }
  const out = new Map<number, number>();
  for (const [bar, list] of bars) {
    const degree = chordFor(list, scale, tonic);
    if (degree) out.set(bar, degree);
  }
  return out;
}
