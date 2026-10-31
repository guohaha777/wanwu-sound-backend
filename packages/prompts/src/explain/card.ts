// The whole card for a song: the program's bar and points, the model's checked sentences where there are some, and the
// corpus everywhere else. Without a model each row's sentence is picked from its bank by the song (the same song always
// gets the same line, two songs mostly different ones), so a card offline still follows the music.
import type {MoodId} from '@wanwu-v2/contracts/arrangement';
import type {TextbookTrack} from '@wanwu-v2/contracts/textbook';
import {fill} from '../fill.ts';
import {EMPTY_EXPLAIN} from './accept.ts';
import type {ExplainReply} from './accept.ts';
import {EXPLAIN,EXPLAIN_LIMITS,ROWS} from './corpus.ts';
import type {ExplainCorpus,FactSource,Row} from './corpus.ts';
import {explainPoints,pointWord} from './points.ts';
import type {Points} from './points.ts';
import {actionWords,rhythmNotes,rhythmSaid,soundForTitle} from './rhythm.ts';
import type {RhythmNote} from './rhythm.ts';

export type ExplainFact={label:string;source:string};
export type ExplainCard={
 title:string;mood:MoodId;
 /** Null when the song has no steady beat (pulse none): no bar to draw. */
 rhythm:{notes:RhythmNote[];said:string;actions:string}|null;
 points:Points;
 child:Record<Row,string>;highlight:string[];
 teacher:{facts:ExplainFact[]}&Record<Row,string>;
 /** How many fields came from the model (0 = all corpus): the page marks a card with any as AI's. */
 fromModel:number;
};
type CardTrack=Pick<TextbookTrack,'id'|'title'|'tempoBpm'|'meter'|'rhythmCell'|'mood'|'tonic'|'mode'|'pulse'|'childLine'|'onsetDensity'|'pitchRange'|'brightness'|'repetition'>;
const KEY_NAMES=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const tempoWord=(bpm:number)=>bpm<72?'slow':bpm<96?'medium':bpm<120?'quick':'fast';
/** A small stable hash: which of a bank's lines a song gets. */
const pickIndex=(seed:string,count:number)=>{let h=2166136261;for(const ch of seed){h^=ch.codePointAt(0)!;h=Math.imul(h,16777619);}return (h>>>0)%count;};

/**
 * Pure: the card for a song. `sources` says where the numbers and the bar came from (课本 / 测量 / AI / 示例), for the
 * teacher's facts line.
 */
export function explainCard(track:CardTrack,reply:ExplainReply|null,sources:{numbers:FactSource;rhythm:FactSource},corpus:ExplainCorpus=EXPLAIN):ExplainCard{
 const pulse=track.pulse??'strong',r=reply??EMPTY_EXPLAIN,points=explainPoints(track,corpus);
 const notes=pulse==='none'?null:rhythmNotes(track.rhythmCell,r.sound??soundForTitle(track.title,corpus),pulse==='strong',corpus);
 const actions=actionWords(track.rhythmCell,corpus),said=notes?rhythmSaid(notes,track.rhythmCell):'';
 const long=notes?.find(note=>note.beats>=1)?.syllable??notes?.[notes.length-1]?.syllable??'';
 const corpusLine=(row:Row)=>{
  const {feature,value}=points[row],bank=corpus.child[row][feature]?.[value]??[];
  return fill(bank[pickIndex(`${track.id}:${row}`,bank.length)]??'',{action:actions,long});
 };
 const teacherLine=(row:Row)=>fill(corpus.teacher[row][points[row].feature]??'',{word:pointWord(points[row],corpus),rhythm:said,action:actions});
 const facts:ExplainFact[]=[],source=(s:FactSource)=>corpus.facts.sources[s];
 facts.push({label:pulse==='none'?corpus.facts.free:pulse==='even'?corpus.facts.even:fill(corpus.facts.metre,{metre:track.meter}),source:source(sources.numbers)});
 if(pulse!=='none')facts.push({label:`${corpus.facts.tempo[tempoWord(track.tempoBpm)]} ${Math.round(track.tempoBpm)}`,source:source(sources.numbers)});
 if(track.tonic!==undefined)facts.push({label:`${KEY_NAMES[track.tonic]} ${corpus.facts.mode[track.mode]??''}`.trim(),source:source(sources.numbers)});
 if(pulse!=='none')facts.push({label:fill(corpus.facts.rhythm,{action:actions}),source:source(sources.rhythm)});
 const child=Object.fromEntries(ROWS.map(row=>[row,r[row]??corpusLine(row)])) as Record<Row,string>;
 const teacher=Object.fromEntries(ROWS.map(row=>[row,r.teacher[row]??teacherLine(row)])) as Record<Row,string>;
 return {
  title:r.title??([...track.childLine].length<=EXPLAIN_LIMITS.title?track.childLine:`「${track.title}」`),mood:track.mood,
  rhythm:notes?{notes,said,actions}:null,points,child,
  // A highlight whose line was replaced by the corpus has nothing to mark.
  highlight:r.highlight.filter(word=>ROWS.some(row=>r[row]?.includes(word))),
  teacher:{facts,...teacher},
  fromModel:[r.title,r.sound,...ROWS.map(row=>r[row]),...ROWS.map(row=>r.teacher[row])].filter(Boolean).length,
 };
}
