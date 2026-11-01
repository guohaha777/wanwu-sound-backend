// Pick a predominant, continuous line from multi-pitch events; retain uncertainty instead of claiming score truth.
import {TEXTBOOK_MELODY_VERSION} from '@wanwu-v2/contracts/textbook-melody';
import type {TextbookMelody,MelodyNote,MelodyPhrase} from '@wanwu-v2/contracts/textbook-melody';
export type TranscribedNote={startTimeSeconds:number;durationSeconds:number;pitchMidi:number;amplitude:number};
import melodyRules from '../rules/melody.v1.json' with {type:'json'};
export const MELODY_ANALYSIS=melodyRules;
export function selectMelody(events:readonly TranscribedNote[],info:{tempo:number;meter:number;excerptStart:number;excerptSeconds:number;audioToken:string}):TextbookMelody{
 const r=MELODY_ANALYSIS,beat=60/info.tempo;
 const candidates=events.filter(n=>Number.isFinite(n.startTimeSeconds)&&n.startTimeSeconds>=0
  &&Number.isFinite(n.durationSeconds)&&n.durationSeconds>=r.minDuration
  &&n.startTimeSeconds<info.excerptSeconds&&Number.isInteger(n.pitchMidi)&&n.pitchMidi>=r.minMidi&&n.pitchMidi<=r.maxMidi
  &&Number.isFinite(n.amplitude)&&n.amplitude>=r.minConfidence&&n.amplitude<=1)
  .sort((a,b)=>a.startTimeSeconds-b.startTimeSeconds||b.amplitude-a.amplitude).slice(0,4000);
 const ticks=[...new Set(candidates.flatMap(n=>[n.startTimeSeconds,Math.min(info.excerptSeconds,n.startTimeSeconds+n.durationSeconds)]))].sort((a,b)=>a-b);
 // Dynamic programming over active MIDI states with a gap state, weighted by salience and voice continuity.
 const layers:{midi:number;confidence:number;score:number;previous:number}[][]=[];
 for(let i=0;i<ticks.length-1;i++){
  const start=ticks[i]!,end=ticks[i+1]!,mid=(start+end)/2;
  const active=candidates.filter(n=>n.startTimeSeconds<=mid&&n.startTimeSeconds+n.durationSeconds>mid);
  const byPitch=new Map<number,number>();for(const n of active)byPitch.set(n.pitchMidi,Math.max(n.amplitude,byPitch.get(n.pitchMidi)??0));
  const states=[...byPitch].map(([midi,confidence])=>({midi,confidence,score:0,previous:-1}));
  if(!states.length)states.push({midi:0,confidence:0,score:0,previous:-1});
  const prev=layers.at(-1);
  for(const state of states){
   let best=-Infinity;
   for(let j=0;j<(prev?.length??1);j++){
    const before=prev?.[j],leap=before?.midi&&state.midi?Math.abs(before.midi-state.midi):0;
    const score=(before?.score??0)+state.confidence*(end-start)-r.transitionPenalty*leap-(leap>r.maxLeap?.15:0);
    if(score>best){best=score;state.previous=j;}
   }
   state.score=best;
  }
  layers.push(states);
 }
 const selected:{start:number;end:number;midi:number;confidence:number}[]=[];
 let index=layers.at(-1)?.reduce((best,s,i,all)=>s.score>all[best]!.score?i:best,0)??0;
 for(let i=layers.length-1;i>=0;i--){const state=layers[i]![index]!;
  if(state.midi)selected.push({start:ticks[i]!,end:ticks[i+1]!,midi:state.midi,confidence:state.confidence});index=state.previous;}
 selected.reverse();
 const merged:typeof selected=[];
 for(const n of selected){const last=merged.at(-1);if(last&&last.midi===n.midi&&Math.abs(last.end-n.start)<.025){
  const total=n.end-last.start;last.confidence=(last.confidence*(last.end-last.start)+n.confidence*(n.end-n.start))/total;last.end=n.end;
 }else merged.push({...n});}
 const valid=merged.filter(n=>n.end-n.start>=r.minDuration);
 const origin=valid[0]?.start??0;
 const notes:MelodyNote[]=[];
 for(const n of valid){
  const atBeat=Math.max(0,Math.round((n.start-origin)/beat*4)/4);
  const endBeat=Math.round((n.end-origin)/beat*4)/4;
  const previous=notes.at(-1);if(previous&&previous.atBeat+previous.beats>atBeat)previous.beats=atBeat-previous.atBeat;
  if(endBeat>atBeat)notes.push({atBeat,beats:Math.min(8,endBeat-atBeat),midi:n.midi,confidence:n.confidence});
 }
 const usable=notes.filter(n=>n.beats>0),phrases:MelodyPhrase[]=[];
 let group:MelodyNote[]=[];
 const flush=()=>{if(group.length>=r.minPhraseNotes){phrases.push({id:`phrase:${phrases.length+1}`,startBeat:group[0]!.atBeat,endBeat:group.at(-1)!.atBeat+group.at(-1)!.beats,notes:group});}group=[];};
 for(const n of usable){
  if(group.length&&(n.atBeat-group[0]!.atBeat>=info.meter*r.phraseBars||n.atBeat-(group.at(-1)!.atBeat+group.at(-1)!.beats)>=1))flush();
  group.push(n);
 }
 flush();
 const confidence=usable.reduce((sum,n)=>sum+n.confidence*n.beats,0)/Math.max(.001,usable.reduce((sum,n)=>sum+n.beats,0));
 return {version:TEXTBOOK_MELODY_VERSION,source:'basic-pitch',modelVersion:r.version,
  status:usable.length>=r.minNotes&&phrases.length>0&&confidence>=r.minConfidence?'extracted':'uncertain',
  ...info,leadSeconds:origin,confidence,phrases:phrases.slice(0,r.maxPhrases)};
}
