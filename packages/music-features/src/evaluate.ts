// 评估: what the program measured against what a professional filled in for the same recording (系统音乐上传, the
// internal page), field by field, and a summary per set (system songs / test set) and per measuring path. Every answer is
// optional: a field nobody filled is not judged. Pure, so the lab page and any script judge the same way.
import type {Metre,TextbookMode} from '@wanwu-v2/contracts/textbook';
import type {MeasurePath} from '@wanwu-v2/sound-rules/rules';
import type {Measurement,SoundFeatures} from './measure.ts';

/**
 * What a professional may fill in (all optional). `voice` (人声) is kept for the audio model; the program does not
 * judge it.
 */
export type MusicAnswers={
 tonic?:number;
 mode?:TextbookMode;
 meter?:Metre;
 tempoBpm?:number;
 downbeatSeconds?:number;
 rhythmCell?:number[];
 musical?:boolean;
 rhythm?:SoundFeatures['rhythm'];
 texture?:SoundFeatures['texture'];
 drums?:boolean;
 voice?:boolean;
};
export const ANSWER_FIELDS=[
 'musical','rhythm','texture','drums','tempoBpm','meter','downbeatSeconds','tonic','mode','rhythmCell',
] as const;
export type AnswerField=typeof ANSWER_FIELDS[number];
/** One judged field. `note` names a typical slip: double / half tempo, the relative key, a strong beat a beat off. */
export type FieldCheck={field:AnswerField;ok:boolean;note?:'double'|'half'|'relative'|'offbeat'};
/** Tempo within this share counts as right (plan §9: ±4 %). */
export const TEMPO_TOLERANCE=.04;
/** A strong beat this close to the answer's bar grid counts as right. */
export const DOWNBEAT_TOLERANCE_SECONDS=.08;

const near=(a:number,b:number)=>Math.abs(a/b-1)<=TEMPO_TOLERANCE;
const sameCell=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i]!)<1e-6);

/** Pure: each field the answers fill, judged against the measurement; `picked` is the rhythm the card would use (pickRhythm). */
export function judge(m:Measurement,a:MusicAnswers,picked:readonly number[]=m.candidates[0]?.cell??[]):FieldCheck[]{
 const checks:FieldCheck[]=[];
 const put=(field:AnswerField,ok:boolean,note?:FieldCheck['note'])=>checks.push(note?{field,ok,note}:{field,ok});
 if(a.musical!==undefined)put('musical',m.musical===a.musical);
 if(a.rhythm!==undefined)put('rhythm',m.features.rhythm===a.rhythm);
 if(a.texture!==undefined)put('texture',m.features.texture===a.texture);
 if(a.drums!==undefined)put('drums',m.features.drums===a.drums);
 if(a.tempoBpm!==undefined){
  const ok=near(m.tempoBpm,a.tempoBpm);
  put('tempoBpm',ok,ok?undefined:near(m.tempoBpm,a.tempoBpm*2)?'double':near(m.tempoBpm,a.tempoBpm/2)?'half':undefined);
 }
 if(a.meter!==undefined)put('meter',m.meter===a.meter);
 if(a.downbeatSeconds!==undefined){
  // On the answer's own bar grid (its tempo and metre when filled): a strong beat a whole bar later is still right.
  const beat=60/(a.tempoBpm??m.tempoBpm),bar=beat*(a.meter??m.meter);
  const off=((m.downbeatSeconds-a.downbeatSeconds)%bar+bar)%bar,distance=Math.min(off,bar-off);
  const beatOff=((m.downbeatSeconds-a.downbeatSeconds)%beat+beat)%beat;
  const ok=distance<=DOWNBEAT_TOLERANCE_SECONDS;
  put('downbeatSeconds',ok,!ok&&Math.min(beatOff,beat-beatOff)<=DOWNBEAT_TOLERANCE_SECONDS?'offbeat':undefined);
 }
 if(a.tonic!==undefined){
  const ok=m.tonic===a.tonic;
  // The relative key: a major key read as the minor a minor third below, or the other way round.
  const relative=a.mode!==undefined
   &&a.mode!==m.mode
   &&(a.mode==='minor'?(a.tonic+3)%12===m.tonic:(a.tonic+9)%12===m.tonic);
  put('tonic',ok,!ok&&relative?'relative':undefined);
 }
 if(a.mode!==undefined)put('mode',m.mode===a.mode);
 if(a.rhythmCell!==undefined)put('rhythmCell',sameCell(picked,a.rhythmCell));
 return checks;
}

export type JudgedRecording={set:'system'|'test';path:MeasurePath;checks:readonly FieldCheck[]};
/** Right / judged for one field, and how many of the misses were each typical slip. */
export type FieldScore={right:number;judged:number;notes:Partial<Record<NonNullable<FieldCheck['note']>,number>>};
export type Summary=Partial<Record<AnswerField,FieldScore>>;

/** Pure: per-field scores over some recordings. */
export function summarise(recordings:readonly Pick<JudgedRecording,'checks'>[]):Summary{
 const out:Summary={};
 for(const {checks} of recordings)for(const check of checks){
  const score=out[check.field]??={right:0,judged:0,notes:{}};
  score.judged++;
  if(check.ok)score.right++;
  if(check.note)score.notes[check.note]=(score.notes[check.note]??0)+1;
 }
 return out;
}

/** Pure: the summary per set, and per measuring path within each set (plan §9: judged per type of music). */
export function report(recordings:readonly JudgedRecording[]){
 const sets=['system','test'] as const;
 return Object.fromEntries(sets.map(set=>{
  const mine=recordings.filter(r=>r.set===set);
  const paths=[...new Set(mine.map(r=>r.path))];
  return [set,{
   count:mine.length,
   all:summarise(mine),
   byPath:Object.fromEntries(paths.map(path=>[path,summarise(mine.filter(r=>r.path===path))])),
  }];
 })) as Record<'system'|'test',{count:number;all:Summary;byPath:Partial<Record<MeasurePath,Summary>>}>;
}
