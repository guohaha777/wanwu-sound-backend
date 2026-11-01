// 课本音乐特征模板 (textbook-v1): one card per textbook song. Extracted once at development time — numbers by code
// (tempo, metre, rhythm cell, density, range, brightness, mode), words by AI (mood, the line for children) — then
// checked by ear and shipped with the page as JSON, so matching and the local background work without a network.
// Only features and provenance are kept, never the song itself. The background borrows rhythm and feel from it,
// never its melody, and never changes the child's sounds or placement.
import {MOODS} from './arrangement.ts';
import type {MoodId} from './arrangement';

export const TEXTBOOK_CONTRACT_VERSION='textbook-v1' as const;

export type TextbookMode='major'|'minor'|'pentatonic'|'dorian';
export const TEXTBOOK_MODES:readonly TextbookMode[]=['major','minor','pentatonic','dorian'];
export type Level='low'|'medium'|'high';
export const LEVELS:readonly Level[]=['low','medium','high'];
export type Density='sparse'|'medium'|'busy';
export const DENSITIES:readonly Density[]=['sparse','medium','busy'];
export type Brightness='dark'|'mid'|'bright';
export const BRIGHTNESSES:readonly Brightness[]=['dark','mid','bright'];
export type Metre=2|3|4;

export type TextbookTrack={
 version:typeof TEXTBOOK_CONTRACT_VERSION;
 id:string;
 /** Name shown to children. */
 title:string;
 /** Where it comes from in the textbook; null for the made-up examples shown before the catalogue is connected. */
 source:{edition:string;grade:number;unit:number;title:string}|null;
 tempoBpm:number;
 meter:Metre;
 /** The song's core rhythm, in beats (e.g. [1,.5,.5,2] = long, short short, longer): the background's melody rhythm. */
 rhythmCell:number[];
 onsetDensity:Density;
 /** Lowest and highest note (MIDI). */
 pitchRange:{low:number;high:number};
 brightness:Brightness;
 mode:TextbookMode;
 repetition:Level;
 mood:MoodId;
 /** Key centre as a pitch class (0 = C … 11 = B), measured from the recording; missing = the background uses the mood's. */
 tonic?:number;
 /**
  * How the beat may be used, from how the recording was measured: missing = steady with strong beats; `even` = a steady
  * beat whose strong beats are not sure (a single line, 清唱) — every tick the same, metre not named; `none` = free
  * rhythm (散板, 山歌) — no tempo is claimed, no beat is played, the background does not follow it.
  */
 pulse?:'even'|'none';
 /** One line a child understands: “像走路，一步一步”. */
 childLine:string;
 /** What made which part: `example` marks the made-up examples; words by `code` = the corpus line used when no model
  *  answered (a teaching-music card made on the page). */
 extraction:{
  numbers:'code'|'score'|'example';
  words:'ai'|'teacher'|'code'|'example';
  confidence:number;
  earChecked:boolean;
 };
};

const nonEmpty=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
const midi=(value:unknown)=>Number.isInteger(value)&&(value as number)>=21&&(value as number)<=108;

/** Validates a template card (the shipped JSON, or a future server list) before the page trusts it. */
export function isTextbookTrack(value:unknown):value is TextbookTrack{
 if(!value||typeof value!=='object')return false;
 const raw=value as Record<string,unknown>;
 if(raw.version!==TEXTBOOK_CONTRACT_VERSION
  ||!nonEmpty(raw.id)
  ||!nonEmpty(raw.title)
  ||!nonEmpty(raw.childLine))return false;
 const source=raw.source as Record<string,unknown>|null;
 if(source!==null
  &&(!source
   ||typeof source!=='object'
   ||!nonEmpty(source.edition)
   ||!nonEmpty(source.title)
   ||!Number.isInteger(source.grade)
   ||!Number.isInteger(source.unit)))return false;
 if(typeof raw.tempoBpm!=='number'
  ||raw.tempoBpm<40
  ||raw.tempoBpm>200
  ||![2,3,4].includes(raw.meter as number))return false;
 const cell=raw.rhythmCell;
 if(!Array.isArray(cell)
  ||!cell.length
  ||cell.length>16
  ||!cell.every(beats=>typeof beats==='number'&&beats>=.25&&beats<=4))return false;
 const range=raw.pitchRange as Record<string,unknown>|null;
 if(!range||!midi(range.low)||!midi(range.high)||(range.low as number)>(range.high as number))return false;
 if(!DENSITIES.includes(raw.onsetDensity as Density)
  ||!BRIGHTNESSES.includes(raw.brightness as Brightness)
  ||!TEXTBOOK_MODES.includes(raw.mode as TextbookMode))return false;
 if(!LEVELS.includes(raw.repetition as Level)||!MOODS.includes(raw.mood as MoodId))return false;
 if(raw.tonic!==undefined
  &&!(Number.isInteger(raw.tonic)&&(raw.tonic as number)>=0&&(raw.tonic as number)<=11))return false;
 if(raw.pulse!==undefined&&raw.pulse!=='even'&&raw.pulse!=='none')return false;
 const extraction=raw.extraction as Record<string,unknown>|null;
 return !!extraction
  &&['code','score','example'].includes(extraction.numbers as string)
  &&['ai','teacher','code','example'].includes(extraction.words as string)
  &&typeof extraction.confidence==='number'
  &&extraction.confidence>=0
  &&extraction.confidence<=1
  &&typeof extraction.earChecked==='boolean';
}
