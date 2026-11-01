// Fixed sample inputs for checking prompts without a model. Names are made up and deliberately personal-looking, so the
// tests can prove they never reach a prompt.
import type { BackgroundBrief, BriefSound } from '@wanwu-v2/contracts/background';
import type { Discovery, TextbookTalkBrief, WorkTalkBrief } from '@wanwu-v2/contracts/talk';
import { tokenizeFacts } from '../../src/accept.ts';
import { textbookTalk } from '../../src/corpus.ts';

export const PERSONAL_NAMES = ['小林家的狗', '王老师的铃', '后山的风'];
export const pageFacts: Discovery[] = [
  { kind: 'opening', first: '小林家的狗', next: '后山的风' },
  { kind: 'repeat', name: '小林家的狗', times: 3 },
  { kind: 'together', a: '后山的风', b: '王老师的铃' },
  {
    kind: 'long-short',
    long: '后山的风',
    longSeconds: 6.2,
    short: '王老师的铃',
    shortSeconds: 0.5,
  },
  { kind: 'rest', seconds: 3 },
  { kind: 'ending', name: '小林家的狗', same: true },
];
export const tokenized = tokenizeFacts(pageFacts);
export const workBrief: WorkTalkBrief = {
  version: 'work-talk-brief-v1',
  seconds: 30,
  mood: 'calm',
  textbookTitle: '摇篮曲',
  facts: tokenized.facts,
};

const lullaby = {
  title: '摇篮曲',
  meter: 3 as const,
  rhythmCell: [2, 1],
  childLine: '像摇篮轻轻晃',
};
export const textbookBrief: TextbookTalkBrief = {
  version: 'textbook-talk-brief-v1',
  title: '摇篮曲',
  metre: 3,
  rhythm: '嗒— 嗒',
  childLine: '像摇篮轻轻晃',
  meeting: 'together',
  example: '声音1',
  local: textbookTalk(lullaby, 'together', '声音1'),
};

const rules = {
  analysis: 'analysis-v2',
  shaping: 'shaping-v3',
  background: 'background-v1',
  mix: 'mix-v2',
};
const sound = (
  n: number,
  start: number,
  end: number,
  extra: Partial<BriefSound> = {},
): BriefSound => ({
  n,
  start,
  end,
  pitch: 'mid',
  length: 'medium',
  contour: null,
  intensity: 'medium',
  pattern: 'once',
  kind: 'one',
  brightness: 'mid',
  ...extra,
});
/** A calm, sparse piece: high, rising sounds early, one long one later. */
export const calmLullaby: BackgroundBrief = {
  version: 'background-request-v2',
  workId: 'work:fixture-1',
  seconds: 30,
  mood: 'calm',
  sounds: [
    sound(1, 1, 3, { pitch: 'high', contour: 'rising', intensity: 'soft' }),
    sound(2, 2, 5, { pitch: 'high', length: 'long', kind: 'texture' }),
    sound(1, 20, 24, { pitch: 'high', contour: 'rising', intensity: 'soft' }),
  ],
  attempt: 0,
  previous: null,
  instruments: ['marimba'],
  rules,
};
/** A busy, happy piece of short, loud, repeating low sounds. */
export const busyNoSong: BackgroundBrief = {
  version: 'background-request-v2',
  workId: 'work:fixture-2',
  seconds: 20,
  mood: 'happy',
  sounds: Array.from({ length: 10 }, (_, i) =>
    sound(1 + (i % 2), i * 2, i * 2 + 1.5, {
      pitch: 'low',
      length: 'short',
      intensity: 'loud',
      pattern: 'repeat',
      contour: 'falling',
    }),
  ),
  attempt: 0,
  previous: null,
  instruments: [],
  rules,
};
export const quietNoMood: BackgroundBrief = {
  ...busyNoSong,
  workId: 'work:fixture-3',
  seconds: 45,
  mood: null,
  sounds: [sound(1, 40, 44, { brightness: 'dark' })],
};
export const BACKGROUND_BRIEFS = [calmLullaby, busyNoSong, quietNoMood];
/** A textbook song's features (the textbook-words task, not the AI background). */
export const lullabyFeatures = {
  id: 'tb:mock:lullaby',
  tempoBpm: 66,
  meter: 3 as const,
  rhythmCell: [2, 1],
  onsetDensity: 'sparse' as const,
  pitchRange: { low: 57, high: 69 },
  brightness: 'dark' as const,
  mode: 'major' as const,
  repetition: 'medium' as const,
  mood: 'calm' as const,
};
