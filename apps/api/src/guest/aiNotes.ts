// AI notes: the language model writes only a musical idea (a 2–6 note motif, four sections' density and register, a bass
// pulse); this develops it with the same harmony as the local background, so the AI step never fights the rules:
// - chords, rhythm and the ending (dominant → tonic inside the piece) come from backgroundPlan unchanged;
// - the motif plays only in the gaps between the child's sounds, as whole phrases, every other time a step higher
//   (a sequence), more often in busy sections and with longer rests in sparse ones;
// - register moves the motif by an octave; bassPulse drops, keeps or repeats the bass on every beat.
// Same brief + same idea → same notes. The child's sounds and placement are never touched.
import type {BackgroundBrief,BackgroundNoteData} from '@wanwu-v2/contracts/background';
import type {MusicIdea} from '@wanwu-v2/prompts/tasks';
import {backgroundPlan} from '@wanwu-v2/sound-rules/background';
import {mergeSpans} from '@wanwu-v2/sound-rules/mix';
import {BACKGROUND_RULES} from '@wanwu-v2/sound-rules/rules';
import type {BackgroundRules} from '@wanwu-v2/sound-rules/rules';

const REGISTER={low:-12,mid:0,high:12} as const;
/** Rest after each motif, in motif lengths. */
const REST={sparse:2,medium:1,busy:0} as const;
const MIDI_LOW=36,MIDI_HIGH=96;

export function developIdea(brief:BackgroundBrief,idea:MusicIdea,rules:BackgroundRules=BACKGROUND_RULES):BackgroundNoteData[]{
 const textbook=brief.textbook?{...brief.textbook,...(brief.variation?{variation:brief.variation}:{})}:null;
 const plan=backgroundPlan({seconds:brief.seconds,sounding:brief.sounding,mood:brief.mood,textbook,seed:brief.workId},rules);
 const beat=60/plan.tempo,bar=beat*plan.metre,end=plan.cadenceAt,seconds=plan.seconds;
 const {scale}=rules.modes[plan.mode],{liftSemitones,minGapBeats,marginSeconds,noteLengthPortion}=rules.melody;
 const base=plan.tonic+liftSemitones;
 const midiOf=(degree:number,register:keyof typeof REGISTER)=>Math.min(MIDI_HIGH,Math.max(MIDI_LOW,
  base+scale[((degree%7)+7)%7]!+12*Math.floor(degree/7)+REGISTER[register]));

 const busy=mergeSpans(brief.sounding.map(span=>({start:span.start-marginSeconds,end:span.end+marginSeconds})),seconds);
 const gaps:{start:number;end:number}[]=[];let from=0;
 for(const span of [...busy,{start:seconds,end:seconds}]){if(span.start-from>=minGapBeats*beat)gaps.push({start:from,end:span.start});from=Math.max(from,span.end);}

 const motifBeats=idea.motifBeats.reduce((sum,value)=>sum+value,0),motifLength=motifBeats*beat;
 const melody:BackgroundNoteData[]=[],part=end/4,repeats=[0,0,0,0];
 for(let t=0;t<end-1e-9;){
  const index=Math.min(3,Math.floor(t/part+1e-9)),section=idea.sections[index]!;
  const fits=gaps.some(gap=>t>=gap.start-1e-9&&t+motifLength<=Math.min(gap.end,end)+1e-9);
  if(!fits){t+=beat;continue;}
  const shift=repeats[index]!%2===1?1:0;repeats[index]!++;
  let at=t;
  idea.motifDegrees.forEach((degree,i)=>{
   const length=idea.motifBeats[i]!*beat;
   melody.push({at,length:length*noteLengthPortion,midi:midiOf(degree+shift,section.register),part:'melody',
    accent:Math.abs(at/bar-Math.round(at/bar))<1e-6?.85:.6});
   at+=length;
  });
  t+=motifLength*(1+REST[section.density]);
  t=Math.ceil(t/beat-1e-9)*beat;
 }
 // Like the local melody, land on the tonic with the last chord when no child's sound is there.
 if(gaps.some(gap=>end>=gap.start-1e-9&&Math.min(seconds,end+beat)<=gap.end+1e-9))
  melody.push({at:end,length:seconds-end,midi:midiOf(0,idea.sections[3]!.register),part:'melody',accent:.85});

 const planBass=plan.notes.filter(note=>note.part==='bass');
 const bass=idea.bassPulse==='none'?[]:idea.bassPulse==='slow'?planBass:planBass.flatMap(note=>{
  const out:BackgroundNoteData[]=[];
  for(let at=note.at;at<note.at+note.length-1e-9;at+=beat)out.push({...note,at,length:Math.min(beat*noteLengthPortion,note.at+note.length-at)});
  return out;
 });
 return [...plan.notes.filter(note=>note.part==='chord'||note.part==='rhythm'),...bass,...melody]
  .filter(note=>note.length>0&&note.at+note.length<=seconds+1e-6)
  .map(note=>({at:note.at,length:note.length,midi:note.midi,part:note.part,accent:note.accent}))
  .sort((a,b)=>a.at-b.at);
}
