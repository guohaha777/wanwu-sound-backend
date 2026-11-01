// Opt-in arrangement for 万物成曲, shelf and export. The sound field keeps assignParts and its original notes.
import {assignParts,ORIGINAL_PLAYER} from './background.ts';
import type {BackgroundPlan,PlayerRoles,SoundingSpan} from './background.ts';
import rules from '../rules/orchestration.v1.json' with {type:'json'};

export const ORCHESTRATION_RULES=rules;

/** A selected instrument plays its leading parts, or joins a compatible part when its lead is absent. */
export function orchestrateBackground(
 plan:BackgroundPlan,
 chosen:readonly PlayerRoles[],
 sounding:readonly SoundingSpan[],
){
 const parts=assignParts(chosen);
 // No instruments selected means precisely the original background.
 if(!chosen.length)return {plan,parts,gains:{}};
 let notes=plan.notes.map(note=>({...note}));
 const drummers=chosen.filter(player=>player.lead.includes('rhythm'));
 if(drummers.length&&!notes.some(note=>note.part==='rhythm')){
  const beat=60/plan.tempo;
  const bar=beat*plan.metre;
  const quiet=rules.quietMoods.includes(plan.colour);
  const hits=rules.patterns[String(plan.metre) as keyof typeof rules.patterns];
  for(let start=0;start<plan.seconds;start+=bar){
   for(const [offset,strength] of hits){
    if(quiet&&offset!==0)continue;
    const at=start+offset!*beat;
    if(at>=plan.seconds)continue;
    if(at>=plan.cadenceAt&&offset!==0)continue;
    const occupied=sounding.some(sound=>sound.start<=at&&sound.end>at);
    const accent=occupied?rules.underChildAccent:quiet?rules.quietAccent:rules.drumAccent;
    notes.push({at,length:Math.min(rules.drumSeconds,plan.seconds-at),midi:0,part:'rhythm',accent:accent*strength!});
   }
  }
 }
 // A pitched player whose leading part is missing joins an existing compatible harmonic part.
 for(const player of chosen){
  const audible=notes.some(note=>parts[note.part].includes(player.id));
  if(audible)continue;
  const part=player.can.find(part=>notes.some(note=>note.part===part));
  if(!part)continue;
  parts[part]=parts[part].filter(id=>id!==ORIGINAL_PLAYER);
  parts[part].push(player.id);
 }
 // A drum cannot carry pitch: let it lead, with quieter original harmony rather than discarding the composition.
 const gains=chosen.length===1&&drummers.length===1
  ?{chord:rules.drumLeadBacking,bass:rules.drumLeadBacking,melody:rules.drumLeadBacking}
  :{};
 notes.sort((a,b)=>a.at-b.at);
 return {plan:{...plan,notes},parts,gains};
}
