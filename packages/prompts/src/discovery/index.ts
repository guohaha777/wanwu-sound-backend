// 音乐小发现 for pages and the server: the local corpus, the program's candidates and local set, and the whole-set
// acceptance. The prompt that asks a model for a set stays in ../tasks (server only).
export { DISCOVERY_CORPUS, EVIDENCE_VALUES, discoveryCorpusProblems } from './corpus.ts';
export type { DiscoveryCorpus, PointTemplate } from './corpus.ts';
export {
  observationBasisLines,
  actionLabel,
  angleOf,
  basisLines,
  candidatePoints,
  localSet,
} from './local.ts';
export { acceptDiscoverySet } from './accept.ts';
export type { SetAcceptance } from './accept.ts';
