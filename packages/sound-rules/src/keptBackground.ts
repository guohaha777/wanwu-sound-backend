// 作品留住的背景 (KeptBackground): the composed notes a saved piece keeps, laid back into the local plan's frame so the
// shelf, the server and 音乐小发现 play exactly what 万物成曲 played. The local plan gives the length, fades,
// 背景让一让 and colour; the kept music gives its tempo, metre, key, ending point and notes.
import type { BackgroundNoteData, KeptBackground } from '@wanwu-v2/contracts/background';
import type { ComposedNotes } from './aiCompose.ts';
import type { BackgroundPlan } from './background.ts';

/** What a saved piece keeps of a composed background (AI 作曲 / 程序自编). */
export function keptBackground(
  composed: Pick<ComposedNotes, 'tempo' | 'metre' | 'tonic' | 'cadenceAt'>,
  mode: KeptBackground['mode'],
  notes: readonly BackgroundNoteData[],
): KeptBackground {
  return {
    tempo: composed.tempo,
    metre: composed.metre,
    mode,
    tonic: composed.tonic,
    cadenceAt: composed.cadenceAt,
    notes: notes.map((note) => ({ ...note })),
  };
}

/** The plan that plays the kept music: everything else (length, fades, ducking, colour) comes from the local plan. */
export function keptPlan(plan: BackgroundPlan, kept: KeptBackground): BackgroundPlan {
  return {
    ...plan,
    tempo: kept.tempo,
    metre: kept.metre,
    mode: kept.mode,
    tonic: kept.tonic,
    cadenceAt: kept.cadenceAt,
    notes: kept.notes.map((note) => ({ ...note })),
  };
}
