// 讲解卡 (@wanwu-v2/prompts/explain): the explanation card of a song, in a fixed structure the page lays out. Parts:
// - ./corpus.ts  the words and weights (corpus/explain.v2.json), checked when loaded;
// - ./rhythm.ts  the bar said by the program (syllables, action words);
// - ./points.ts  which feature each of 听一听 / 动一动 / 玩一玩 talks about;
// - ./accept.ts  the model's sentences, checked field by field;
// - ./card.ts    the card: the model's checked sentences, the corpus everywhere else.
export {EXPLAIN,EXPLAIN_LIMITS,FEATURE_VALUES,ROWS,explainProblems} from './corpus.ts';
export type {ExplainCorpus,FactSource,Feature,Row} from './corpus.ts';
export {actionWords,rhythmNotes,rhythmSaid,soundForTitle,soundsForPrompt} from './rhythm.ts';
export type {RhythmNote} from './rhythm.ts';
export {explainPoints,featureValues,onBar,pointKeywords,pointWord} from './points.ts';
export type {Point,PointFeatures,Points} from './points.ts';
export {EMPTY_EXPLAIN,acceptExplain,isExplainReply,similarity} from './accept.ts';
export type {ExplainCheck,ExplainReply} from './accept.ts';
export {explainCard} from './card.ts';
export type {ExplainCard,ExplainFact} from './card.ts';
