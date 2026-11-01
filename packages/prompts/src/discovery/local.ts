// The program's part of 音乐小发现: which features are worth telling (candidates, ranked by the weights in sound-rules
// discovery.v1.json, one per kind and angle, each with the first of its tries the page can do now), the evidence lines
// a teacher sees, and the local set — the floor when no model writes one. Everything is written with tokens
// (「声音1」) and read back with the child's names, like an AI set.
import type {
  DiscoveryBrief,
  DiscoveryAction,
  DiscoveryPoint,
  DiscoverySet,
  Evidence,
  PointText,
} from '@wanwu-v2/contracts/discovery';
import { DISCOVERY_RULES } from '@wanwu-v2/sound-rules/discovery';
import type { DiscoveryRules } from '@wanwu-v2/sound-rules/discovery';
import { fill } from '../fill.ts';
import { DISCOVERY_CORPUS } from './corpus.ts';
import type { DiscoveryCorpus } from './corpus.ts';

/** What a point is about: its kind and its sounds. Two points of one set never tell the same angle. */
export const angleOf = (evidence: Pick<Evidence, 'kind' | 'sounds'>) =>
  `${evidence.kind}|${evidence.sounds.join(',')}`;

/** The labels of the page's actions, as the corpus words them. */
export const actionLabel = (
  action: Pick<DiscoveryAction, 'kind' | 'target'>,
  corpus: DiscoveryCorpus = DISCOVERY_CORPUS,
) => fill(corpus.actions[action.kind], { target: action.target ?? '' });

/** The first of a kind's tries the page can do now, aimed at one of the evidence's own sounds when it has any. */
function pickAction(item: Evidence, actions: readonly DiscoveryAction[], corpus: DiscoveryCorpus) {
  for (const kind of Object.keys(corpus.kinds[item.kind].tries)) {
    const candidates = actions.filter((action) => action.kind === kind);
    const action =
      candidates.find((candidate) => candidate.target === null) ??
      item.sounds
        .map((sound) => candidates.find((candidate) => candidate.target === sound))
        .find(Boolean) ??
      (item.sounds.length ? undefined : candidates[0]);
    if (action) return action;
  }
  return null;
}

/** The features worth telling, most telling first: one per kind and angle, each with a try the page can do. */
export function candidatePoints(
  evidence: readonly Evidence[],
  actions: readonly DiscoveryAction[],
  {
    max = DISCOVERY_RULES.candidates,
    rules = DISCOVERY_RULES,
    corpus = DISCOVERY_CORPUS,
  }: { max?: number; rules?: DiscoveryRules; corpus?: DiscoveryCorpus } = {},
): DiscoveryPoint[] {
  const ranked = evidence
    .map((item, order) => ({ item, order }))
    .filter(({ item }) => rules.weights[item.kind] > 0)
    .sort((a, b) => rules.weights[b.item.kind] - rules.weights[a.item.kind] || a.order - b.order);
  const kinds = new Set<string>();
  const points: DiscoveryPoint[] = [];
  for (const { item } of ranked) {
    if (points.length >= max) break;
    if (kinds.has(item.kind)) continue;
    const action = pickAction(item, actions, corpus);
    if (!action) continue;
    kinds.add(item.kind);
    points.push({ id: `P${points.length + 1}`, evidence: [item.id], action: action.id });
  }
  return points;
}

/** The evidence of a point in the teacher's words (program data; shown with AI and local sets alike). */
export const basisLines = (
  ids: readonly string[],
  evidence: readonly Evidence[],
  corpus: DiscoveryCorpus = DISCOVERY_CORPUS,
) =>
  ids
    .map((id) => evidence.find((item) => item.id === id))
    .filter((item): item is Evidence => !!item)
    .map((item) => fill(corpus.kinds[item.kind].basis, item.values));

/** The local set: the first `maxPoints` candidates, each written with the corpus, and the summary made of them. */
export function localSet(
  points: readonly DiscoveryPoint[],
  evidence: readonly Evidence[],
  actions: readonly DiscoveryAction[],
  {
    rules = DISCOVERY_RULES,
    corpus = DISCOVERY_CORPUS,
  }: { rules?: DiscoveryRules; corpus?: DiscoveryCorpus } = {},
): DiscoverySet {
  const written: PointText[] = [];
  const phrases: string[] = [];
  const topics: string[] = [];
  for (const point of points.slice(0, rules.maxPoints)) {
    const item = evidence.find((entry) => entry.id === point.evidence[0])!;
    const action = actions.find((entry) => entry.id === point.action)!;
    const template = corpus.kinds[item.kind];
    const values = { ...item.values, target: action.target ?? '' };
    written.push({
      point: point.id,
      action: point.action,
      where: fill(template.where, values),
      evidence: [...point.evidence],
      knowledge: fill(template.knowledge, values),
      discovery: fill(template.discovery, values),
      ask: fill(template.ask, values),
      try: fill(template.tries[action.kind] ?? template.tries.replay, values),
      teacher: {
        concept: fill(template.teacher.concept, values),
        how: fill(template.teacher.how, values),
        listen: fill(template.teacher.listen, values),
      },
    });
    phrases.push(fill(template.summaryPhrase, values));
    if (!topics.includes(template.topic)) topics.push(template.topic);
  }
  return {
    points: written,
    summary: {
      child: fill(corpus.summary.child, { phrases: phrases.join(corpus.summary.phraseJoin) }),
      teacher: fill(corpus.summary.teacher, {
        topics: topics.map((topic) => `「${topic}」`).join(corpus.summary.topicJoin),
      }),
    },
  };
}

/** Provenance text is shared by AI entries and their local alternatives. */
export function observationBasisLines(ids: readonly string[], brief: DiscoveryBrief): string[] {
  return ids.flatMap((id) => {
    const item = brief.observations?.find((entry) => entry.id === id);
    return item
      ? [
          fill(DISCOVERY_CORPUS.observationBasis, {
            range: item.range.join('–'),
            observation: item.observation,
            basis: item.basis,
          }),
        ]
      : [];
  });
}
