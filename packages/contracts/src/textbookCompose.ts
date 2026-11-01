// Isolated textbook path. Nothing here changes the free-AI background contract.
import type {MoodId} from './arrangement.ts';
import {MOODS} from './arrangement.ts';
import {isKeptBackground} from './background.ts';
import type {BriefSound} from './background.ts';
import type {TextbookTrack} from './textbook.ts';
import {isTextbookTrack} from './textbook.ts';

export const TEXTBOOK_COMPOSE_VERSION='textbook-compose-v1' as const;
export type FeatureSource='child'|'preset'|'measurement'|'model'|'teacher'|'default'|'unknown';
export type TextbookSound=BriefSound&{
 eventId:string;
 /** Absent provenance is unknown, never upgraded to a child's choice or a measurement. */
 sources?:Partial<Record<'pitch'|'length'|'contour'|'intensity'|'pattern'|'kind'|'brightness',FeatureSource>>;
};
export type TextbookComposeInput={
 version:typeof TEXTBOOK_COMPOSE_VERSION;
 seconds:number;
 /** Local content token for source/excerpt identity; contains no raw audio. */
 contentToken?:string;
 mood:MoodId|null;
 textbook:TextbookTrack;
 sounds:readonly TextbookSound[];
};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const member=(v:unknown,values:readonly unknown[])=>values.includes(v);
export function isTextbookComposeInput(value:unknown):value is TextbookComposeInput{
 if(!value||typeof value!=='object')return false;
 const v=value as TextbookComposeInput;
 if(v.version!==TEXTBOOK_COMPOSE_VERSION||!finite(v.seconds)||v.seconds<=0||v.seconds>60
  ||(v.mood!==null&&!MOODS.includes(v.mood))||!isTextbookTrack(v.textbook&&{...v.textbook,rhythmCell:Array.isArray(v.textbook.rhythmCell)&&v.textbook.rhythmCell.length===0?[1]:v.textbook.rhythmCell})
  ||!Array.isArray(v.sounds)||v.sounds.length>64)return false;
 if(v.contentToken!==undefined&&(typeof v.contentToken!=='string'||!/^ai:[a-f0-9]{16}$/.test(v.contentToken)))return false;
 const ids=new Set<string>();
 for(const s of v.sounds){
  if(!s||typeof s.eventId!=='string'||!s.eventId||ids.has(s.eventId)
   ||!Number.isInteger(s.n)||s.n<1||!finite(s.start)||!finite(s.end)
   ||s.start<0||s.end<=s.start||s.end>v.seconds
   ||!member(s.pitch,['low','mid','high'])||!member(s.length,['short','medium','long'])
   ||!member(s.contour,[null,'rising','falling','flat','wavy'])
   ||!member(s.intensity,['soft','medium','loud'])||!member(s.pattern,['once','repeat','bursts','fade-in'])
   ||!member(s.kind,['one','series','texture'])||!member(s.brightness,['dark','mid','bright']))return false;
  if(s.sources&&(typeof s.sources!=='object'||Array.isArray(s.sources)
   ||Object.entries(s.sources).some(([key,source])=>!member(key,['pitch','length','contour','intensity','pattern','kind','brightness'])
    ||!member(source,['child','preset','measurement','model','teacher','default','unknown']))))return false;
  ids.add(s.eventId);
 }
 return true;
}

/** A finished textbook layer is kept verbatim, so later model/rule updates cannot silently change a shelved piece. */
export type TextbookSnapshot={
 version:'textbook-snapshot-v1';identity:string;inputToken:string;mood:MoodId|null;
 track:TextbookTrack;
 references:{phraseId:string;at:number;sourceNotes:number[];transform:('mode-fit'|'octave'|'retrograde'|'fragment')[]}[];
 music:import('./background.ts').KeptBackground&{
  rules:string;mix:string;source:'local-rules';seconds:number;colour:MoodId|'none';textbook:string;
  fadeInSeconds:number;fadeOutSeconds:number;duck:{at:number;gain:number}[];
 };
};

export function isTextbookSnapshot(value:unknown):value is TextbookSnapshot{
 if(!value||typeof value!=='object')return false;
 const v=value as TextbookSnapshot,m=v.music;
 return v.version==='textbook-snapshot-v1'&&typeof v.identity==='string'&&/^textbook:[a-f0-9]{16}$/.test(v.identity)
  &&typeof v.inputToken==='string'&&/^ai:[a-f0-9]{16}$/.test(v.inputToken)
  &&(v.mood===null||MOODS.includes(v.mood))&&isTextbookTrack(v.track)&&!!m
  &&isKeptBackground(m)&&m.source==='local-rules'&&typeof m.rules==='string'&&!!m.rules&&typeof m.mix==='string'&&!!m.mix
  &&finite(m.seconds)&&m.seconds>0&&m.seconds<=60&&m.textbook===v.track.id
  &&Array.isArray(v.references)&&v.references.length<=128&&v.references.every(q=>{
   const phrase=v.track.melody?.phrases.find(p=>p.id===q?.phraseId);
   return !!phrase&&finite(q.at)&&q.at>=0&&q.at<m.seconds&&Array.isArray(q.sourceNotes)&&q.sourceNotes.length>=2
    &&q.sourceNotes.length<=64&&q.sourceNotes.every(i=>Number.isInteger(i)&&i>=0&&i<phrase.notes.length)
    &&Array.isArray(q.transform)&&q.transform.length<=4&&q.transform.every(t=>['mode-fit','octave','retrograde','fragment'].includes(t));
  })
  &&(m.colour==='none'||MOODS.includes(m.colour))&&m.cadenceAt<m.seconds
  &&finite(m.fadeInSeconds)&&m.fadeInSeconds>=0&&m.fadeInSeconds<=m.seconds/2
  &&finite(m.fadeOutSeconds)&&m.fadeOutSeconds>=0&&m.fadeOutSeconds<=m.seconds/2
  &&m.tempo===v.track.tempoBpm&&m.metre===v.track.meter
  &&m.notes.every(n=>n.at+n.length<=m.seconds+1e-6&&(n.part==='rhythm'?n.midi===0:n.midi>=21&&n.midi<=108))
  &&Array.isArray(m.duck)&&m.duck.length<=512&&m.duck.every((p,i)=>p&&finite(p.at)&&p.at>=0&&p.at<=m.seconds
   &&finite(p.gain)&&p.gain>=0&&p.gain<=1&&(i===0||p.at>=m.duck[i-1]!.at));
}
