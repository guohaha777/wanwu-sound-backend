// 音乐小发现的本地语料 (corpus/discovery-cards.v1.json): for each kind of evidence one complete point — the
// music-making idea (a technique and what it does), how it shows in the piece, a question, small tries (one per action
// kind, always one 从头再听), the teacher's side, the evidence line and its words for the summary — plus the action
// labels, the summary frames and the words a child's line may not use. Checked when loaded (placeholders, slot lengths,
// child words), so a bad edit fails `npm test`, never a page.
import { DISCOVERY_ACTION_KINDS, EVIDENCE_KINDS } from '@wanwu-v2/contracts/discovery';
import type {
  DiscoveryActionKind,
  EvidenceKind,
  EvidenceSource,
} from '@wanwu-v2/contracts/discovery';
import { MOODS } from '@wanwu-v2/contracts/arrangement';
import type { MoodId } from '@wanwu-v2/contracts/arrangement';
import cardsFile from '../../corpus/discovery-cards.v1.json' with { type: 'json' };
import { unknownPlaceholders } from '../fill.ts';
import { wordProblems } from '../style.ts';
import type { Slot } from '../style.ts';

export type PointTemplate = {
  knowledge: string;
  where: string;
  discovery: string;
  ask: string;
  /** In order of preference; `replay` is always there, so every point has one try the page can do. */
  tries: Partial<Record<DiscoveryActionKind, string>> & { replay: string };
  teacher: { concept: string; how: string; listen: string };
  /** The evidence in the teacher's words (program data, shown with every set). */
  basis: string;
  summaryPhrase: string;
  topic: string;
};
export type DiscoveryCorpus = {
  version: string;
  sources: Record<EvidenceSource, string>;
  observationBasis: string;
  actions: Record<DiscoveryActionKind, string>;
  backgroundWhat: Record<'ai' | 'program' | 'textbook' | 'plain', string>;
  originalPlayers: string;
  halves: Record<'first' | 'second', string>;
  measuredBy: Record<'choice' | 'measure', string>;
  directions: Record<'softer' | 'louder', { word: string; picture: string }>;
  moods: Record<MoodId, string>;
  summary: { child: string; teacher: string; phraseJoin: string; topicJoin: string };
  /** Words a child's line may not use (on top of the shared style list): grown-up and lab words. */
  childAvoid: string[];
  teacherAvoid: string[];
  hearingClaims: string[];
  kinds: Record<EvidenceKind, PointTemplate>;
};

/** The values each kind of evidence carries (the page's evidence finder fills exactly these). */
export const EVIDENCE_VALUES: Record<EvidenceKind, readonly string[]> = {
  opening: ['first'],
  repeat: ['sound', 'times'],
  return: ['a', 'b'],
  overlap: ['a', 'b'],
  'long-short': ['long', 'short', 'longSeconds', 'shortSeconds'],
  rest: ['seconds'],
  density: ['busier', 'early', 'late'],
  ending: ['last'],
  'cut-ending': ['sound'],
  single: ['sound'],
  'high-low': ['high', 'low', 'by'],
  background: ['what', 'players'],
  masked: ['sound', 'backgroundLouderDb'],
  'gap-filled': ['seconds'],
  dynamics: ['direction', 'picture', 'differenceDb'],
  mood: ['mood'],
};
/** Each written part and the style slot it is checked against; `child` parts are said to the child. */
export const POINT_SLOTS = {
  knowledge: 'cardKnowledge',
  where: 'cardFind',
  discovery: 'cardFind',
  ask: 'cardAsk',
  try: 'cardTry',
} as const satisfies Record<string, Slot>;
export const TEACHER_SLOTS = {
  concept: 'teacherConcept',
  how: 'teacherHow',
  listen: 'teacherListen',
} as const satisfies Record<string, Slot>;
export const SUMMARY_SLOTS = {
  child: 'summaryChild',
  teacher: 'summaryTeacher',
} as const satisfies Record<string, Slot>;

export function discoveryCorpusProblems(file: DiscoveryCorpus) {
  const problems: string[] = [];
  const check = (
    path: string,
    text: unknown,
    slot: Slot,
    allowed: readonly string[],
    child: boolean,
  ) => {
    if (typeof text !== 'string' || !text.trim()) {
      problems.push(`${path} 缺少`);
      return;
    }
    problems.push(...unknownPlaceholders(path, text, allowed));
    problems.push(...wordProblems(text, slot).map((problem) => `${path}：${problem}`));
    if (child)
      for (const word of file.childAvoid ?? [])
        if (text.includes(word)) problems.push(`${path}：给孩子的话里用了「${word}」`);
  };
  const words = (
    path: string,
    table: Record<string, unknown> | undefined,
    keys: readonly string[],
  ) => {
    for (const key of keys)
      if (typeof table?.[key] !== 'string' || !(table[key] as string).trim())
        problems.push(`${path}.${key} 缺少`);
  };
  if (typeof file.version !== 'string' || !file.version)
    problems.push('discovery-cards.version 应该是版本名');
  for (const kind of DISCOVERY_ACTION_KINDS) {
    const label = file.actions?.[kind];
    if (typeof label !== 'string' || !label.trim())
      problems.push(`discovery-cards.actions.${kind} 缺少`);
    else
      problems.push(...unknownPlaceholders(`discovery-cards.actions.${kind}`, label, ['target']));
  }
  words('discovery-cards.backgroundWhat', file.backgroundWhat, [
    'ai',
    'program',
    'textbook',
    'plain',
  ]);
  words('discovery-cards.halves', file.halves, ['first', 'second']);
  words('discovery-cards.measuredBy', file.measuredBy, ['choice', 'measure']);
  words('discovery-cards.moods', file.moods, MOODS);
  for (const way of ['softer', 'louder'] as const)
    words(`discovery-cards.directions.${way}`, file.directions?.[way], ['word', 'picture']);
  words('discovery-cards.summary', file.summary, ['child', 'teacher', 'phraseJoin', 'topicJoin']);
  if (file.summary) {
    problems.push(
      ...unknownPlaceholders('discovery-cards.summary.child', file.summary.child, ['phrases']),
    );
    problems.push(
      ...unknownPlaceholders('discovery-cards.summary.teacher', file.summary.teacher, ['topics']),
    );
  }
  if (typeof file.originalPlayers !== 'string' || !file.originalPlayers.trim())
    problems.push('discovery-cards.originalPlayers 缺少');
  for (const list of ['childAvoid', 'hearingClaims'] as const)
    if (
      !Array.isArray(file[list]) ||
      !file[list].every((word) => typeof word === 'string' && word.trim())
    )
      problems.push(`discovery-cards.${list} 应该是一组词`);
  for (const kind of EVIDENCE_KINDS) {
    const point = file.kinds?.[kind];
    const path = `discovery-cards.kinds.${kind}`;
    if (!point) {
      problems.push(`${path} 缺少`);
      continue;
    }
    const allowed = EVIDENCE_VALUES[kind];
    for (const [field, slot] of Object.entries(POINT_SLOTS)) {
      if (field === 'try') continue;
      check(
        `${path}.${field}`,
        point[field as 'knowledge' | 'discovery' | 'ask'],
        slot,
        allowed,
        true,
      );
    }
    for (const [field, slot] of Object.entries(TEACHER_SLOTS))
      check(
        `${path}.teacher.${field}`,
        point.teacher?.[field as keyof typeof TEACHER_SLOTS],
        slot,
        allowed,
        false,
      );
    check(`${path}.basis`, point.basis, 'teacherBasis', allowed, false);
    check(`${path}.summaryPhrase`, point.summaryPhrase, 'cardFind', allowed, true);
    check(`${path}.topic`, point.topic, 'cardKnowledge', [], false);
    if (!point.tries?.replay)
      problems.push(`${path}.tries.replay 缺少（每一点都要有一个从头再听）`);
    for (const [action, text] of Object.entries(point.tries ?? {})) {
      if (!DISCOVERY_ACTION_KINDS.includes(action as DiscoveryActionKind))
        problems.push(`${path}.tries.${action} 不认识（拼错了？）`);
      else check(`${path}.tries.${action}`, text, 'cardTry', [...allowed, 'target'], true);
    }
  }
  for (const kind of Object.keys(file.kinds ?? {}))
    if (!EVIDENCE_KINDS.includes(kind as EvidenceKind))
      problems.push(`discovery-cards.kinds.${kind} 不认识（拼错了？）`);
  return problems;
}

const problems = discoveryCorpusProblems(cardsFile as DiscoveryCorpus);
if (problems.length) throw new Error(`语料文件有误：\n${problems.join('\n')}`);
export const DISCOVERY_CORPUS = cardsFile as DiscoveryCorpus;
