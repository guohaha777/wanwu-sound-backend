// 教学要点: which feature of this song each row talks about. 听一听 / 动一动 / 玩一玩 follow 课标 1–2 年级「唱游·音乐」
// (感受与欣赏 / 表现 / 创造); each row takes the most distinctive feature it can talk about that an earlier row has not
// taken, so one card says three different things and two songs say different things. Distinctive = far from a typical
// children's song (a tempo of 136 more than 96, 3/4 more than 2/4, a high register more than a middle one); the weights
// are in the corpus (`points`). Pure and repeatable: the same song always gets the same points, with or without a model.
import type {TextbookTrack} from '@wanwu-v2/contracts/textbook';
import {EXPLAIN,ROWS} from './corpus.ts';
import type {ExplainCorpus,Feature,Row} from './corpus.ts';

/** What the points are chosen from: the card's own measured features. */
export type PointFeatures=Pick<TextbookTrack,
 'tempoBpm'|'meter'|'rhythmCell'|'onsetDensity'|'pitchRange'|'brightness'|'mode'|'repetition'|'pulse'>;
export type Point={feature:Feature;value:string;salience:number};
export type Points=Record<Row,Point>;

/** Each feature's value for this song and how distinctive it is (0–1+). */
export function featureValues(
 f:PointFeatures,
 corpus:ExplainCorpus=EXPLAIN,
):Partial<Record<Feature,{value:string;salience:number}>>{
 const p=corpus.points;
 /** The rule file's weight for a feature's value. */
 const w=(feature:Feature,value:string)=>p.salience[feature]?.[value]??0;
 const free=f.pulse==='none';
 const tempo=f.tempoBpm>=p.tempo.fastFrom?'fast':f.tempoBpm<p.tempo.slowBelow?'slow':'medium';
 const centre=(f.pitchRange.low+f.pitchRange.high)/2;
 const register=centre>=p.register.highFrom?'high':centre<=p.register.lowTo?'low':'mid';
 // Tempo and register stand out more the further they are from the middle.
 const out:Partial<Record<Feature,{value:string;salience:number}>>={
  tempo:{
   value:tempo,
   salience:tempo==='medium'
    ?w('tempo','medium')
    :.5+Math.min(.5,Math.abs(f.tempoBpm-p.tempo.centre)/p.tempo.span),
  },
  register:{
   value:register,
   salience:register==='mid'
    ?w('register','mid')
    :.5+Math.min(.4,Math.abs(centre-p.register.centre)/p.register.span),
  },
  brightness:{value:f.brightness,salience:w('brightness',f.brightness)},
  density:{value:f.onsetDensity,salience:w('density',f.onsetDensity)},
  mode:{value:f.mode,salience:w('mode',f.mode)},
  repetition:{value:f.repetition,salience:w('repetition',f.repetition)},
 };
 const metre=free?'free':f.pulse==='even'?'even':String(f.meter);
 out.metre={value:metre,salience:w('metre',metre)};
 if(!free){
  const cell=f.rhythmCell;
  const shorts=cell.filter(b=>b<=.5).length;
  const rhythm=cell.includes(.75)
   ?'dotted'
   :shorts>=3
    ?'running'
    :cell.some(b=>b>=1.5)
     ?'long'
     :'plain';
  out.rhythm={value:rhythm,salience:w('rhythm',rhythm)};
  // Where the bar's longest note is (only when it is a beat or longer and not all notes are equal).
  const longest=Math.max(...cell);
  const at=cell.indexOf(longest);
  const longNote=longest>=1&&longest>Math.min(...cell)
   ?at===0
    ?'start'
    :at===cell.length-1
     ?'end'
     :'middle'
   :'none';
  out.longNote={value:longNote,salience:w('longNote',longNote)};
 }
 return out;
}

/**
 * Pure: each row's point — the most distinctive feature it may talk about that no earlier row took (ties: list
 * order).
 */
export function explainPoints(f:PointFeatures,corpus:ExplainCorpus=EXPLAIN):Points{
 const values=featureValues(f,corpus);
 const rows=corpus.points.rows;
 const free=f.pulse==='none';
 const used=new Set<Feature>();
 const listOf:Record<Row,Feature[]>={
  listen:rows.listen,
  move:free?rows.moveFree:rows.move,
  play:free?rows.playFree:rows.play,
 };
 const out={} as Points;
 for(const row of ROWS){
  let best:Point|null=null;
  for(const feature of listOf[row]){
   const v=values[feature];
   if(!v||used.has(feature))continue;
   const score=v.salience+(corpus.points.rowBonus[row]?.[feature]??0);
   if(!best||score>best.salience)best={feature,value:v.value,salience:score};
  }
  // Every row has at least the metre left (free songs list it first for 动 and 玩).
  best??={feature:'metre',value:values.metre!.value,salience:0};
  used.add(best.feature);
  out[row]=best;
 }
 return out;
}
/** How a point is named (for teachers, and in the prompt): 「音区偏高」. */
export const pointWord=(point:Pick<Point,'feature'|'value'>,corpus:ExplainCorpus=EXPLAIN)=>
 corpus.teacherWords[point.feature]?.[point.value]??'';
export const pointKeywords=(point:Pick<Point,'feature'|'value'>,corpus:ExplainCorpus=EXPLAIN)=>
 corpus.keywords[point.feature]?.[point.value]??[];
/** Whether a row's point depends on the bar (it no longer fits once the bar is the program's instead of the model's). */
export const onBar=(point:Pick<Point,'feature'>)=>point.feature==='rhythm'||point.feature==='longNote';
