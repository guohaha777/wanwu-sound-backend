// Versioned discovery evidence, current-mix observations, available actions and complete teaching entries.
// Program facts, child choices and model observations retain their separate provenance.
import {MOODS} from './arrangement.ts';
import type {MoodId} from './arrangement.ts';
import {isSoundToken} from './talk.ts';
import type {SoundToken} from './talk.ts';

export const DISCOVERY_BRIEF_VERSION='discovery-brief-v2' as const;

/**
 * Where a piece of evidence comes from: the arrangement (order, timing), a measure of the recording, the child's own
 * choice on the sound card, the background the page plays, or the program measuring the two layers as they are heard.
 */
export type EvidenceSource='arrangement'|'measure'|'choice'|'background'|'listening';
export const EVIDENCE_SOURCES:readonly EvidenceSource[]=['arrangement','measure','choice','background','listening'];

export type EvidenceKind=
 |'opening'|'repeat'|'return'|'overlap'|'long-short'|'rest'|'density'|'ending'|'cut-ending'|'single'
 |'high-low'|'background'|'masked'|'gap-filled'|'dynamics'|'mood';
export const EVIDENCE_KINDS:readonly EvidenceKind[]=[
 'opening','repeat','return','overlap','long-short','rest','density','ending','cut-ending','single',
 'high-low','background','masked','gap-filled','dynamics','mood',
];

/** One thing the program found. `values` hold tokens, words and numbers the cards may quote; nothing else is a fact. */
export type Evidence={
 id:string;
 kind:EvidenceKind;
 source:EvidenceSource;
 sounds:SoundToken[];
 /** Seconds in the piece, rounded to a tenth; null when it is about the whole piece. */
 range:[number,number]|null;
 values:Record<string,string|number>;
};

/** What a child can do in the tools right now; a card's small try uses exactly one of these. */
export type DiscoveryActionKind='replay'|'move'|'swap'|'remove'|'add'|'gap'|'instrument'|'volume'|'background';
export const DISCOVERY_ACTION_KINDS:readonly DiscoveryActionKind[]=[
 'replay','move','swap','remove','add','gap','instrument','volume','background',
];
export type DiscoveryAction={id:string;kind:DiscoveryActionKind;target:SoundToken|null;label:string;occurrence?:number;range?:[number,number];options?:string[]};

/** What the brief says about one sound: where it is heard, what the child chose and what was measured. */
export type BriefedSound={
 token:SoundToken;
 times:number;
 /** Each placement's start and end in seconds (a tenth). */
 spans:[number,number][];
 chosen:{pitch:string|null;length:string|null;loudness:string|null};
 measured:{pitch:string|null;length:string|null;loudnessDb:number|null};
};

export type DiscoveryBackground={
 /** off, AI 作曲, 程序自编, the textbook song's background, or the plain local one. */
 kind:'off'|'ai'|'program'|'textbook'|'plain';
 instruments:string[];
 level:'soft'|'medium'|'loud'|null;
 gain?:number;
};

/**
 * A candidate the program offers: its evidence (the first is the main one) and the one try the page can do for it.
 * The program ranks a few; the model chooses which to tell and may relate them to any other evidence.
 */
export type AudioObservation={
 id:string;range:[number,number];layer:'background'|'child'|'mix';
 observation:string;basis:string;keywords:string[];
};
export type DiscoveryPoint={id:string;evidence:string[];action:string};

/** Anonymous evidence and optional full current mix for a two-stage analysis round. */
export type DiscoveryBrief={
 version:typeof DISCOVERY_BRIEF_VERSION;
 mode:'data'|'audio';
 /** Complete current mix, never original recordings; transient request only. */
 audio?:string;
 observations?:AudioObservation[];
 /** Actual note plan, not inferred from the background source's label. Fixed audio has no score. */
 backgroundMusic?:{tempo:number;metre:number;notes:{at:number;length:number;midi:number;part:string;accent:number}[]}|null;
 seconds:number;
 mood:MoodId|null;
 background:DiscoveryBackground;
 sounds:BriefedSound[];
 evidence:Evidence[];
 actions:DiscoveryAction[];
 points:DiscoveryPoint[];
};

/**
 * What is written for one point. `knowledge` is the music-making idea as this piece shows it — a technique and what it
 * does here ("重复让心情更浓"); `discovery` where it happens in this piece, with an association a child knows; `ask` an
 * open question; `try` the point's action in words. The teacher's side: the idea in plain words, how to lead it, and
 * what to listen for after the try.
 */
export type PointText={
 point:string;
 action?:string;
 where?:string;
 /** Program evidence and valid audio observation IDs supporting this entry. */
 evidence:string[];
 knowledge:string;
 discovery:string;
 ask:string;
 try:string;
 teacher:{concept:string;how:string;listen:string};
};
/** Accepted complete entries. Local collections may also have a short summary. */
export type DiscoverySet={points:PointText[];summary:{child:string;teacher:string}};
export type SetOrigin='local'|'ai';

export const DISCOVERY_LIMITS={sounds:16,evidence:32,actions:128,candidates:32,valueChars:24} as const;

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const text=(value:unknown,max=80):value is string=>typeof value==='string'&&value.length>0&&value.length<=max;
const nullableText=(value:unknown)=>value===null||text(value,12);
const span=(value:unknown):value is [number,number]=>Array.isArray(value)
 &&value.length===2
 &&finite(value[0])
 &&finite(value[1])
 &&value[0]>=0
 &&value[0]<=value[1]
 &&value[1]<=120;

export function isEvidence(value:unknown):value is Evidence{
 if(!value||typeof value!=='object')return false;
 const raw=value as Record<string,unknown>;
 const values=raw.values as Record<string,unknown>|null;
 return text(raw.id,16)
  &&EVIDENCE_KINDS.includes(raw.kind as EvidenceKind)
  &&EVIDENCE_SOURCES.includes(raw.source as EvidenceSource)
  &&Array.isArray(raw.sounds)
  &&raw.sounds.length<=8
  &&raw.sounds.every(isSoundToken)
  &&(raw.range===null||span(raw.range))
  &&!!values
  &&typeof values==='object'
  &&!Array.isArray(values)
  &&Object.keys(values).length<=8
  &&Object.entries(values).every(([key,item])=>text(key,24)
   &&(finite(item)||text(item,DISCOVERY_LIMITS.valueChars)));
}

const isAction=(value:unknown):value is DiscoveryAction=>{
 if(!value||typeof value!=='object')return false;
 const raw=value as Record<string,unknown>;
 return text(raw.id,24)
  &&DISCOVERY_ACTION_KINDS.includes(raw.kind as DiscoveryActionKind)
  &&(raw.target===null||isSoundToken(raw.target))
  &&text(raw.label,24)
  &&(raw.occurrence===undefined||(Number.isInteger(raw.occurrence)&&(raw.occurrence as number)>0))
  &&(raw.range===undefined||span(raw.range))
  &&(raw.options===undefined||(Array.isArray(raw.options)&&raw.options.length<=16&&raw.options.every(item=>text(item,24))));
};

const isBriefedSound=(value:unknown):value is BriefedSound=>{
 if(!value||typeof value!=='object')return false;
 const raw=value as Record<string,unknown>;
 const chosen=raw.chosen as Record<string,unknown>|null;
 const measured=raw.measured as Record<string,unknown>|null;
 return isSoundToken(raw.token)
  &&Number.isInteger(raw.times)
  &&(raw.times as number)>=1
  &&Array.isArray(raw.spans)
  &&raw.spans.length===raw.times
  &&raw.spans.every(span)
  &&!!chosen
  &&nullableText(chosen.pitch)
  &&nullableText(chosen.length)
  &&nullableText(chosen.loudness)
  &&!!measured
  &&nullableText(measured.pitch)
  &&nullableText(measured.length)
  &&(measured.loudnessDb===null||finite(measured.loudnessDb));
};

/** Validates a brief on the server before anything is sent to a model. */
export function isDiscoveryBrief(value:unknown):value is DiscoveryBrief{
 if(!value||typeof value!=='object')return false;
 const raw=value as Record<string,unknown>;
 if(raw.backgroundMusic!=null){
  const music=raw.backgroundMusic as Record<string,unknown>;
  if(!finite(music.tempo)||music.tempo<20||music.tempo>300||![2,3,4].includes(music.metre as number)
   ||!Array.isArray(music.notes)||music.notes.length>2000||!music.notes.every(note=>{
    const n=note as Record<string,unknown>|null;
    return !!n&&finite(n.at)&&n.at>=0&&finite(n.length)&&n.length>0&&finite(n.midi)&&n.midi>=0&&n.midi<=127
     &&['melody','chord','bass','rhythm'].includes(n.part as string)&&finite(n.accent)&&n.accent>=0&&n.accent<=1;
   }))return false;
 }
 if(raw.audio!==undefined&&(typeof raw.audio!=='string'||raw.audio.length>5_000_000||!/^UklGR[A-Za-z0-9+/=]+$/.test(raw.audio)))return false;
 if(raw.observations!==undefined&&(!Array.isArray(raw.observations)||raw.observations.length>16||!raw.observations.every(isAudioObservation)))return false;
 const background=raw.background as Record<string,unknown>|null;
 if(raw.version!==DISCOVERY_BRIEF_VERSION||!['data','audio'].includes(raw.mode as string)||!finite(raw.seconds)||raw.seconds<=0||raw.seconds>120)
  return false;
 if(raw.mood!==null&&!MOODS.includes(raw.mood as MoodId))return false;
 if(!background
  ||!['off','ai','program','textbook','plain'].includes(background.kind as string)
  ||!Array.isArray(background.instruments)
  ||background.instruments.length>3
  ||!background.instruments.every(item=>text(item,12))
  ||!(background.level===null||['soft','medium','loud'].includes(background.level as string)))return false;
 if(!Array.isArray(raw.sounds)
  ||!raw.sounds.length
  ||raw.sounds.length>DISCOVERY_LIMITS.sounds
  ||!raw.sounds.every(isBriefedSound))return false;
 if(!Array.isArray(raw.evidence)
  ||!raw.evidence.length
  ||raw.evidence.length>DISCOVERY_LIMITS.evidence
  ||!raw.evidence.every(isEvidence)
  ||new Set(raw.evidence.map(item=>(item as Evidence).id)).size!==raw.evidence.length)return false;
 if(!Array.isArray(raw.actions)
  ||!raw.actions.length
  ||raw.actions.length>DISCOVERY_LIMITS.actions
  ||!raw.actions.every(isAction))return false;
 const evidenceIds=new Set((raw.evidence as Evidence[]).map(item=>item.id));
 const actionIds=new Set((raw.actions as DiscoveryAction[]).map(item=>item.id));
 return Array.isArray(raw.points)
  &&raw.points.length>=1
  &&raw.points.length<=DISCOVERY_LIMITS.candidates
  &&raw.points.every((point,i)=>{
   const item=point as Record<string,unknown>;
   return item?.id===`P${i+1}`
    &&Array.isArray(item.evidence)
    &&item.evidence.length>=1
    &&item.evidence.every(id=>evidenceIds.has(id as string))
    &&actionIds.has(item.action as string);
  });
}

/** Model observations remain estimates with their own provenance, not program measurements. */
export function isAudioObservation(value:unknown):value is AudioObservation{
 if(!value||typeof value!=='object')return false;
 const x=value as Record<string,unknown>;
 return typeof x.id==='string'&&/^O\d{1,2}$/.test(x.id)&&span(x.range)
  &&['background','child','mix'].includes(x.layer as string)
  &&text(x.observation,180)&&text(x.basis,180)&&Array.isArray(x.keywords)
  &&x.keywords.length<=5&&x.keywords.every(k=>text(k,16));
}
