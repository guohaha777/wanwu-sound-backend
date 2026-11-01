// 作品概况 (textbook-match-v1): the child's arrangement in the same words textbook songs are described with — how busy
// (疏密), how much repeats (重复), how high (音区) and the mood. Sent (as words only) with an AI background request.
// Local and rule-based; the thresholds live in ../rules/textbook-match.v1.json so the music role can tune them.
import type {Arrangement,MoodId} from '@wanwu-v2/contracts/arrangement';
import type {PitchChoice} from '@wanwu-v2/contracts/sound';
import type {Density,Level} from '@wanwu-v2/contracts/textbook';
import {arrange} from './arrange.ts';
import {SHAPING_RULES,TEXTBOOK_MATCH_RULES} from './rules.ts';
import type {ShapingRules,TextbookMatchRules} from './rules.ts';

export type WorkSummary={
 seconds:number;
 /** Single sounds heard per second, over the whole piece. */
 onsetsPerSecond:number;
 density:Density;
 /** Share of placed sounds that repeat something: a sound placed again, or a card set to 重复 / 一阵一阵. */
 repetitionShare:number;
 repetition:Level;
 register:Level;
 mood:MoodId|null;
};

const BANDS:readonly PitchChoice[]=['low','mid','high'];
const levelOf=(value:number,low:number,high:number):Level=>value<low?'low':value>high?'high':'medium';

/** Facts about the arrangement, counted with the same timeline the field plays. Null when nothing is placed. */
export function workSummary(
 arrangement:Arrangement,
 rules:TextbookMatchRules=TEXTBOOK_MATCH_RULES,
 shaping:ShapingRules=SHAPING_RULES,
):WorkSummary|null{
 // Each placed event with its unit (events whose unit is gone are skipped).
 const placed=arrangement.events.flatMap(event=>{
  const unit=arrangement.units.find(item=>item.id===event.unitId);
  return unit?[{event,unit}]:[];
 });
 if(!placed.length)return null;
 let onsets=0,end:number=arrangement.spanSeconds,repeated=0,bandSum=0;
 const seen=new Set<string>();
 for(const {event,unit} of [...placed].sort((a,b)=>a.event.at-b.event.at)){
  const layout=arrange(
   unit.shape,
   unit.analysis??null,
   {start:event.clip.startMs/1000,end:event.clip.endMs/1000},
   shaping.limits.clipMaxSeconds,
   event.id,
   shaping);
  onsets+=layout.events.length;
  end=Math.max(end,event.at*arrangement.spanSeconds+layout.totalSeconds);
  if(seen.has(unit.id)||unit.shape.pattern==='repeat'||unit.shape.pattern==='bursts')repeated++;
  seen.add(unit.id);
  bandSum+=BANDS.indexOf(unit.shape.pitch??unit.analysis?.band??'mid');
 }
 const onsetsPerSecond=onsets/end;
 const repetitionShare=repeated/placed.length;
 const mood=arrangement.mood;
 return {
  seconds:end,
  onsetsPerSecond,
  density:onsetsPerSecond<rules.density.sparseBelow
   ?'sparse'
   :onsetsPerSecond>rules.density.busyAbove
    ?'busy'
    :'medium',
  repetitionShare,
  repetition:levelOf(repetitionShare,rules.repetition.lowBelow,rules.repetition.highAbove),
  register:levelOf(bandSum/placed.length,2/3,4/3),
  mood:mood?.kind==='preset'?mood.id:mood?.kind==='custom'?mood.nearest:null,
 };
}
