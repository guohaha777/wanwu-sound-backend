// The rhythm bar, said by the program: which syllable sounds each note (from the onomatopoeia library) and which action
// word moves it (1 拍 = 走, 半拍 = 跑, 附点 = 跳-跳, 2 拍 = 走——). Nothing here comes from a model.
import { EXPLAIN } from './corpus.ts';
import type { ExplainCorpus } from './corpus.ts';

/** The table's key (a beat length) nearest to `beats`. */
const nearestKey = (table: Record<string, string>, beats: number) =>
  Object.keys(table).reduce((best, key) =>
    Math.abs(Number(key) - beats) < Math.abs(Number(best) - beats) ? key : best,
  );
/** Notes of one bar grouped by beat: the notes that start inside one beat go together (两个半拍 = 跑跑). */
function byBeat<T>(cell: readonly number[], each: (beats: number, i: number) => T): T[][] {
  const groups: T[][] = [];
  let at = 0;
  cell.forEach((beats, i) => {
    // A new group whenever a note starts on a beat.
    if (!groups.length || Math.abs(at - Math.round(at)) < 1e-6) groups.push([]);
    groups[groups.length - 1]!.push(each(beats, i));
    at += beats;
  });
  return groups;
}
/** The action words for a bar, grouped by beat (「跑跑 走」). */
export const actionWords = (cell: readonly number[], corpus: ExplainCorpus = EXPLAIN) =>
  byBeat(cell, (beats) => beats)
    .map((group) =>
      group.length === 2 && group[0] === 0.75 && group[1] === 0.25
        ? corpus.dotted
        : group.map((beats) => corpus.actions[nearestKey(corpus.actions, beats)]!).join(''),
    )
    .join(' ');

/** One note of the rhythm bar: how long, whether it is the strong beat, and the syllable said for it. */
export type RhythmNote = { beats: number; strong: boolean; syllable: string };
/** The bar in an onomatopoeia set: a short syllable under one beat, the long one from a beat (with —— from two). */
export function rhythmNotes(
  cell: readonly number[],
  sound: string,
  strongBeat: boolean,
  corpus: ExplainCorpus = EXPLAIN,
): RhythmNote[] {
  const set = corpus.sounds[sound] ?? corpus.sounds.plain!;
  return cell.map((beats, i) => ({
    beats,
    strong: strongBeat && i === 0,
    syllable:
      beats < 1
        ? set.short
        : beats >= 2
          ? `${set.long}——`
          : beats >= 1.5
            ? `${set.long}—`
            : set.long,
  }));
}
export const rhythmSaid = (notes: readonly RhythmNote[], cell: readonly number[]) =>
  byBeat(cell, (_beats, i) => notes[i]!.syllable)
    .map((group) => group.join(''))
    .join(' ');
/** Offline: the set whose words appear in the song's title (小鸟 → bird), else the plain one. */
export const soundForTitle = (title: string, corpus: ExplainCorpus = EXPLAIN) =>
  Object.entries(corpus.sounds).find(([, set]) =>
    set.words?.some((word) => title.includes(word)),
  )?.[0] ?? 'plain';
/** The library as the prompt lists it: id=名字（短 / 长）. */
export const soundsForPrompt = (corpus: ExplainCorpus = EXPLAIN) =>
  Object.entries(corpus.sounds)
    .map(([id, set]) => `${id}=${set.name}（${set.short} / ${set.long}）`)
    .join('，');
