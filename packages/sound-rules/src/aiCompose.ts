// AI background composition (ai-compose-v1): program and model compose together from the child's piece.
// 1. portrait():   what the piece is like — each sound's features and, for the whole piece, density, which way most
//                  sounds go, how loud and long they are, and how full each quarter is.
// 2. ranges():     for every musical choice (tempo, metre, mode, key, chords, accompaniment, bass, drums, motif lengths)
//                  the options that suit this piece and its mood (numbers in ../rules/ai-compose.v1.json).
// 3. programPlan(): the program's own choice inside those ranges (seeded by the piece and the try): sent to the model as a
//                  reference, and played alone when no AI step gives a background (降级：程序自编).
// 4. fitPlan():    a model's plan, checked: anything outside the ranges or the piece's rules is replaced by the
//                  program's, and a 换一首 that changed too little is changed further.
// 5. composeNotes(): the plan written out as notes — chords, accompaniment pattern, bass, drums and a melody that only
//                  speaks in the gaps between the child's sounds, answering the sound before each gap.
// Pure and repeatable: the same piece, try and plan always give the same notes; browser and server share it.
import type {MoodId} from '@wanwu-v2/contracts/arrangement';
import {COMPOSE_ANSWERS,COMPOSE_BASS,COMPOSE_DRUMS,COMPOSE_PATTERNS,DYNAMICS,SECTION_REGISTERS} from '@wanwu-v2/contracts/background';
import type {
 BackgroundBrief,
 BackgroundNoteData,
 Brightness,
 BriefSound,
 ComposeBass,
 ComposeDrums,
 ComposePattern,
 ComposePlan,
 ComposeSection,
 SectionRegister,
} from '@wanwu-v2/contracts/background';
import type {ContourChoice,DurationChoice,IntensityChoice,PatternChoice,PitchChoice} from '@wanwu-v2/contracts/sound';
import {DENSITIES,TEXTBOOK_MODES} from '@wanwu-v2/contracts/textbook';
import type {Density,Metre,TextbookMode} from '@wanwu-v2/contracts/textbook';
import composeFile from '../rules/ai-compose.v1.json' with {type:'json'};
import {mergeSpans} from './mix.ts';
import {seeded} from './random.ts';
import {compositionSeed} from './compositionIdentity.ts';
import type {CompositionInput} from './compositionIdentity.ts';
import {BACKGROUND_RULES} from './rules.ts';
import type {BackgroundRules} from './rules.ts';

type Pair=[number,number];
type MoodRules={tempo:number;metres:number[];modes:string[];progressions:string[];bass:string[];drums:string[]};
export type StyleCard={id:string;name:string;moods:string[];hint:string};
export type AiComposeRules=Omit<typeof composeFile,'moods'|'patterns'|'bass'|'drums'|'motif'|'styles'>&{
 moods:Record<'none'|MoodId,MoodRules>;
 patterns:Record<PatternChoice|'texture'|'long'|'short',string[]>;
 bass:Record<IntensityChoice,string[]>;
 drums:{quiet:string[];textureShare:number;patterns:Record<string,Record<string,Pair[]>>};
 motif:{notes:Pair;degree:Pair;beats:Record<DurationChoice,Pair>};
 styles:StyleCard[];
};

/** Problems in the rule file, in plain words (empty = fine). */
export function aiComposeProblems(rules:AiComposeRules):string[]{
 const problems:string[]=[];
 const check=(ok:boolean,problem:string)=>{if(!ok)problems.push(problem);};
 const within=(list:readonly unknown[],allowed:readonly unknown[])=>list.length>0&&list.every(item=>allowed.includes(item));
 check(typeof rules.version==='string'&&rules.version.length>0,'aiCompose.version 应该是版本名');
 check(rules.tempo.min<rules.tempo.max&&rules.tempo.span>0&&rules.tempo.shift>=0,'aiCompose.tempo 范围不对');
 check(rules.tonicShift.min<=0&&rules.tonicShift.max>=0,'aiCompose.tonicShift 要包含 0');
 for(const [name,mood] of Object.entries(rules.moods)){
  check(mood.tempo>=rules.tempo.min&&mood.tempo<=rules.tempo.max,`aiCompose.moods.${name}.tempo 超出 tempo 范围`);
  check(within(mood.metres,[2,3,4]),`aiCompose.moods.${name}.metres 只能是 2 / 3 / 4`);
  check(within(mood.modes,TEXTBOOK_MODES),`aiCompose.moods.${name}.modes 有不认识的调式`);
  check(mood.progressions.length>0&&mood.progressions.every(item=>/^[1-7](-[1-7]){1,7}$/.test(item)),
   `aiCompose.moods.${name}.progressions 要写成 1-5-6-4 这样`);
  check(within(mood.bass,COMPOSE_BASS),`aiCompose.moods.${name}.bass 有不认识的低音`);
  check(within(mood.drums,COMPOSE_DRUMS),`aiCompose.moods.${name}.drums 有不认识的鼓`);
 }
 for(const [name,list] of Object.entries(rules.patterns))check(within(list,COMPOSE_PATTERNS),`aiCompose.patterns.${name} 有不认识的音型`);
 for(const [name,list] of Object.entries(rules.bass))check(within(list,COMPOSE_BASS),`aiCompose.bass.${name} 有不认识的低音`);
 check(within(rules.drums.quiet,COMPOSE_DRUMS),'aiCompose.drums.quiet 有不认识的鼓');
 for(const [name,byMetre] of Object.entries(rules.drums.patterns)){
  check(COMPOSE_DRUMS.includes(name as ComposeDrums),`aiCompose.drums.patterns.${name} 不认识`);
  for(const [metre,hits] of Object.entries(byMetre))
   check(hits.every(([at,accent])=>at>=0&&at<Number(metre)&&accent>0&&accent<=1),`aiCompose.drums.patterns.${name}.${metre} 的拍点或力度不对`);
 }
 check(rules.motif.notes[0]>=2&&rules.motif.notes[0]<=rules.motif.notes[1],'aiCompose.motif.notes 至少 2 个音');
 check(Object.values(rules.motif.beats).every(([low,high])=>low>0&&low<=high),'aiCompose.motif.beats 范围不对');
 check(rules.styles.length>0&&rules.styles.every(style=>style.id&&style.name&&style.hint&&within(style.moods,['none',...Object.keys(rules.moods)])),
  'aiCompose.styles 每张风格卡要有 id、名字、提示和适合的心情');
 check(Object.keys(rules.moods).every(mood=>rules.styles.some(style=>style.moods.includes(mood))),'aiCompose.styles 每种心情至少要有一张风格卡');
 return problems;
}

export const AI_COMPOSE_RULES:AiComposeRules=(()=>{
 const rules=composeFile as unknown as AiComposeRules;
 const problems=aiComposeProblems(rules);
 if(problems.length)throw new Error(`规则文件有误：\n${problems.join('\n')}`);
 return rules;
})();

// ----- 1. the portrait -----
const loudnessOf=(db:number,rules:AiComposeRules):IntensityChoice=>db<rules.features.loudness.softBelowDb
 ?'soft'
 :db>rules.features.loudness.loudAboveDb?'loud':'medium';
const brightnessOf=(hz:number,rules:AiComposeRules):Brightness=>hz<rules.features.brightness.darkBelowHz
 ?'dark'
 :hz>rules.features.brightness.brightAboveHz?'bright':'mid';

/** One placed sound's features: the child's choices first, then what the 声音体检 measured, then the middle. */
export function briefSound(
 n:number,
 start:number,
 end:number,
 shape:{pitch?:PitchChoice;duration?:DurationChoice;contour?:ContourChoice;intensity?:IntensityChoice;pattern?:PatternChoice},
 analysis:{band:PitchChoice;lengthBand:DurationChoice;loudnessDb:number;brightnessHz:number;kind:BriefSound['kind'];silent?:boolean}|undefined,
 rules:AiComposeRules=AI_COMPOSE_RULES,
):BriefSound{
 const heard=analysis&&!analysis.silent?analysis:undefined;
 return {
  n,
  start,
  end,
  pitch:shape.pitch??heard?.band??'mid',
  length:shape.duration??heard?.lengthBand??'medium',
  contour:shape.contour??null,
  intensity:shape.intensity??(heard?loudnessOf(heard.loudnessDb,rules):'medium'),
  pattern:shape.pattern??'once',
  kind:heard?.kind??'one',
  brightness:heard?brightnessOf(heard.brightnessHz,rules):'mid',
 };
}

/** The value most sounds have (ties: the first in `order`); null when none has one. */
function most<T extends string>(values:readonly (T|null)[],order:readonly T[]):T|null{
 let best:T|null=null;
 let count=0;
 for(const value of order){
  const n=values.filter(item=>item===value).length;
  if(n>count){
   best=value;
   count=n;
  }
 }
 return best;
}

export type Portrait={
 mood:'none'|MoodId;
 count:number;
 /** Different sounds used (by number). */
 kinds:number;
 /** Share of the piece the child's sounds fill (0–1). */
 coverage:number;
 perBar:number;
 density:Density;
 register:PitchChoice;
 contour:ContourChoice|null;
 intensity:IntensityChoice;
 length:DurationChoice;
 pattern:PatternChoice;
 brightness:Brightness;
 textureShare:number;
 /** The four quarters: how many sounds start in each, how many of them loud, and whether it is full. */
 sections:{start:number;end:number;count:number;loud:number;full:boolean}[];
};

export function portrait(brief:Pick<BackgroundBrief,'seconds'|'mood'|'sounds'>,rules:AiComposeRules=AI_COMPOSE_RULES):Portrait{
 const {seconds,sounds}=brief;
 const mood=brief.mood??'none';
 const covered=mergeSpans(sounds.map(({start,end})=>({start,end})),seconds)
  .reduce((sum,span)=>sum+span.end-span.start,0);
 const coverage=seconds>0?covered/seconds:0;
 // Bars at the mood's tempo in four: how many sounds a bar holds.
 const bar=4*60/rules.moods[mood].tempo;
 const perBar=seconds>0?sounds.length*bar/seconds:0;
 const {density:limits}=rules;
 const density:Density=perBar>=limits.busyAbovePerBar||coverage>=limits.busyCoverage
  ?'busy'
  :perBar<limits.sparseBelowPerBar&&coverage<limits.sparseCoverage?'sparse':'medium';
 const part=seconds/4;
 const sections=[0,1,2,3].map(i=>{
  const inside=sounds.filter(sound=>sound.start>=i*part&&(sound.start<(i+1)*part||i===3));
  return {start:i*part,end:(i+1)*part,count:inside.length,loud:inside.filter(sound=>sound.intensity==='loud').length,full:false};
 });
 for(const section of sections)section.full=sounds.length>0&&section.count/sounds.length>=rules.sections.busyShare;
 return {
  mood,
  count:sounds.length,
  kinds:new Set(sounds.map(sound=>sound.n)).size,
  coverage,
  perBar,
  density,
  register:most(sounds.map(sound=>sound.pitch),['mid','high','low'])??'mid',
  contour:most(sounds.map(sound=>sound.contour),['rising','falling','wavy','flat']),
  intensity:most(sounds.map(sound=>sound.intensity),['medium','loud','soft'])??'medium',
  length:most(sounds.map(sound=>sound.length),['medium','short','long'])??'medium',
  pattern:most(sounds.map(sound=>sound.pattern),['once','repeat','bursts','fade-in'])??'once',
  brightness:most(sounds.map(sound=>sound.brightness),['mid','bright','dark'])??'mid',
  textureShare:sounds.length?sounds.filter(sound=>sound.kind==='texture').length/sounds.length:0,
  sections,
 };
}

// ----- 2. the ranges -----
export type Ranges={
 tempo:Pair;
 metres:Metre[];
 modes:TextbookMode[];
 tonicShift:Pair;
 progressions:string[];
 patterns:ComposePattern[];
 bass:ComposeBass[];
 drums:ComposeDrums[];
 beats:Pair;
 notes:Pair;
};
const unique=<T>(list:readonly T[])=>[...new Set(list)];

export function ranges(view:Portrait,rules:AiComposeRules=AI_COMPOSE_RULES):Ranges{
 const mood=rules.moods[view.mood];
 // Tempo: around the mood's, a little faster for a busy piece or short sounds, slower for a sparse one or long sounds.
 const up=view.density==='busy'||view.length==='short';
 const down=view.density==='sparse'||view.length==='long';
 const centre=mood.tempo+(up&&!down?rules.tempo.shift:down&&!up?-rules.tempo.shift:0);
 const tempo:Pair=[
  Math.max(rules.tempo.min,centre-rules.tempo.span),
  Math.min(rules.tempo.max,centre+rules.tempo.span),
 ];
 // Modes: with no mood, bright sounds lean to the major ones and dark sounds to the minor ones (listed first).
 const modes=view.mood==='none'
  ?view.brightness==='dark'
   ?['minor','dorian','pentatonic','major']
   :view.brightness==='bright'?['major','pentatonic','dorian','minor']:mood.modes
  :mood.modes;
 // Accompaniment: what the sounds' way of appearing, their kind and their length ask for.
 const patterns=unique([
  ...rules.patterns[view.pattern],
  ...(view.textureShare>=rules.drums.textureShare?rules.patterns.texture:[]),
  ...(view.length==='long'?rules.patterns.long:view.length==='short'?rules.patterns.short:[]),
 ]) as ComposePattern[];
 // Bass: what the loudness allows, within the mood's.
 const bassByLoudness=rules.bass[view.intensity].filter(item=>mood.bass.includes(item));
 // Drums: the mood's; only quiet ones under sounds that run together (wind, a stream), and none that fits no allowed metre.
 const metres=mood.metres as Metre[];
 const drumsForMood=mood.drums.filter(item=>view.textureShare<rules.drums.textureShare||rules.drums.quiet.includes(item));
 const drums=(drumsForMood.length?drumsForMood:['none'])
  .filter(item=>item==='none'||metres.some(metre=>rules.drums.patterns[item]?.[String(metre)]));
 return {
  tempo,
  metres,
  modes:modes as TextbookMode[],
  tonicShift:[rules.tonicShift.min,rules.tonicShift.max],
  progressions:mood.progressions,
  patterns,
  bass:(bassByLoudness.length?bassByLoudness:mood.bass) as ComposeBass[],
  drums:(drums.length?drums:['none']) as ComposeDrums[],
  beats:rules.motif.beats[view.length],
  notes:rules.motif.notes,
 };
}

/** Style cards that suit the mood; the try picks one, never the last one used when there is another. */
export function styleCard(view:Portrait,seed:string,attempt:number,previous:string|null,rules:AiComposeRules=AI_COMPOSE_RULES):StyleCard{
 const suited=rules.styles.filter(style=>style.moods.includes(view.mood));
 const choices=suited.length>1?suited.filter(style=>style.id!==previous):suited;
 const random=seeded(`${seed}|style|${attempt}`);
 return choices[Math.floor(random()*choices.length)]!;
}

/** Whether a drum pattern exists in a metre. */
const drumFits=(drums:ComposeDrums,metre:Metre,rules:AiComposeRules)=>drums==='none'||!!rules.drums.patterns[drums]?.[String(metre)];

// ----- 3. the program's own plan -----
const pick=<T>(random:()=>number,list:readonly T[])=>list[Math.floor(random()*list.length)]!;
const quarter=(value:number)=>Math.round(value*4)/4;

/** A motif in the way most sounds go: up, down, there and back, or an arch; one leap; lengths within the range. */
function programMotif(random:()=>number,view:Portrait,range:Ranges){
 const size=Math.min(range.notes[1],Math.max(range.notes[0],3+Math.floor(random()*3)));
 const steps:number[]=[0];
 const way=view.contour==='rising'?1:view.contour==='falling'?-1:0;
 const leapAt=1+Math.floor(random()*(size-1));
 for(let i=1;i<size;i++){
  const size1=i===leapAt?2+Math.floor(random()*2):1;
  const direction=way!==0
   ?way
   :view.contour==='wavy'
    ?(i%2?1:-1)
    :i<size/2?1:-1;
  steps.push(Math.max(-7,Math.min(7,steps[i-1]!+direction*size1)));
 }
 const [low,high]=range.beats;
 const beats=steps.map(()=>quarter(low+random()*(high-low))||low);
 // The phrase ends on its longest note.
 beats[beats.length-1]=Math.max(...beats);
 return {degrees:steps,beats};
}

/** The sections from the piece: full quarters stay sparse and soft, empty ones may speak; the register moves once. */
function programSections(random:()=>number,view:Portrait):ComposeSection[]{
 const registers:SectionRegister[]=view.register==='high'?['low','mid','low','mid']:view.register==='low'?['mid','high','mid','high']:['mid','high','mid','low'];
 const offset=Math.floor(random()*2);
 return view.sections.map((section,i)=>({
  density:section.full?'sparse':section.count===0?pick(random,['medium','busy'] as const):'medium',
  register:registers[(i+offset)%4]!,
  dynamics:section.full||section.loud>0?'soft':section.count===0?'medium':pick(random,['soft','medium'] as const),
 }));
}

const motifDiffers=(a:ComposePlan,b:ComposePlan)=>a.motif.degrees.join()!==b.motif.degrees.join()||a.motif.beats.join()!==b.motif.beats.join();
const DIFFERENCES:((a:ComposePlan,b:ComposePlan,rules:AiComposeRules)=>boolean)[]=[
 (a,b,rules)=>Math.abs(a.tempo-b.tempo)>=rules.variety.tempoStep,
 (a,b)=>a.metre!==b.metre,
 (a,b)=>a.mode!==b.mode,
 (a,b)=>a.tonicShift!==b.tonicShift,
 (a,b)=>a.progressions.join()!==b.progressions.join(),
 (a,b)=>a.pattern!==b.pattern,
 (a,b)=>a.bass!==b.bass,
 (a,b)=>a.drums!==b.drums,
 motifDiffers,
 (a,b)=>a.answer!==b.answer,
];
/** How many of the ten choices differ between two plans. */
export const changedCount=(a:ComposePlan,b:ComposePlan,rules:AiComposeRules=AI_COMPOSE_RULES)=>
 DIFFERENCES.filter(differs=>differs(a,b,rules)).length;

/**
 * Changes a plan until it differs from the last one in at least `variety.minChanged` choices (motif always), each time
 * taking another option inside the ranges. Returns the plan and which choices it changed.
 */
function differFrom(plan:ComposePlan,previous:ComposePlan|null,range:Ranges,view:Portrait,random:()=>number,rules:AiComposeRules){
 if(!previous)return {plan,changed:[] as string[]};
 const next={...plan,motif:{...plan.motif},sections:plan.sections.map(section=>({...section}))};
 const changed:string[]=[];
 const other=<T>(list:readonly T[],current:T)=>{
  const rest=list.filter(item=>item!==current);
  return rest.length?pick(random,rest):current;
 };
 // A new piece of music always has a new motif.
 if(!motifDiffers(next,previous)){
  next.motif=programMotif(random,view,range);
  changed.push('motif');
 }
 const steps:[string,()=>void][]=[
  ['tonicShift',()=>{
   const options=[];
   for(let shift=range.tonicShift[0];shift<=range.tonicShift[1];shift++)options.push(shift);
   next.tonicShift=other(options,previous.tonicShift);
  }],
  ['progressions',()=>{next.progressions=[other(range.progressions,previous.progressions[0]!)];}],
  ['pattern',()=>{next.pattern=other(range.patterns,previous.pattern);}],
  ['tempo',()=>{
   const [low,high]=range.tempo;
   next.tempo=previous.tempo-low>high-previous.tempo?low+Math.round(random()*rules.variety.tempoStep):high-Math.round(random()*rules.variety.tempoStep);
  }],
  ['mode',()=>{next.mode=other(range.modes,previous.mode);}],
  ['bass',()=>{next.bass=other(range.bass,previous.bass);}],
  ['answer',()=>{next.answer=other(COMPOSE_ANSWERS,previous.answer);}],
  ['drums',()=>{next.drums=other(range.drums.filter(item=>drumFits(item,next.metre,rules)),previous.drums);}],
 ];
 for(const [name,change] of steps){
  if(changedCount(next,previous,rules)>=rules.variety.minChanged)break;
  const before=changedCount(next,previous,rules);
  change();
  if(changedCount(next,previous,rules)>before)changed.push(name);
 }
 return {plan:next,changed};
}

/** The program's own plan for this piece and try: a reference for the model, and the background when no AI gives one. */
export function programPlan(
 brief:CompositionInput,
 rules:AiComposeRules=AI_COMPOSE_RULES,
):ComposePlan{
 const view=portrait(brief,rules);
 const range=ranges(view,rules);
 const random=seeded(`${compositionSeed(brief)}|plan`);
 const metre=pick(random,range.metres);
 const drums=range.drums.filter(item=>drumFits(item,metre,rules));
 const plan:ComposePlan={
  tempo:Math.round(range.tempo[0]+random()*(range.tempo[1]-range.tempo[0])),
  metre,
  // The first half of the list: the modes that suit the sounds best.
  mode:pick(random,range.modes.slice(0,Math.max(1,Math.ceil(range.modes.length/2)))),
  tonicShift:range.tonicShift[0]+Math.floor(random()*(range.tonicShift[1]-range.tonicShift[0]+1)),
  progressions:brief.seconds>30?[pick(random,range.progressions),pick(random,range.progressions)]:[pick(random,range.progressions)],
  pattern:pick(random,range.patterns),
  bass:pick(random,range.bass),
  drums:drums.length?pick(random,drums):'none',
  motif:programMotif(random,view,range),
  answer:view.register!=='mid'?'mirror':pick(random,COMPOSE_ANSWERS),
  sections:programSections(random,view),
  style:styleCard(view,compositionSeed(brief),brief.attempt,brief.previous?.style??null,rules).id,
 };
 return differFrom(plan,brief.previous,range,view,random,rules).plan;
}

// ----- 4. checking a model's plan -----
export type FittedPlan={plan:ComposePlan;repairs:string[]};

/**
 * A model's reply made into a plan this piece can use. Every choice outside the ranges is replaced by the program's
 * (and noted); full quarters are kept sparse and soft; the register moves at least once; a 换一首 that changed too little
 * is changed further. Null only when the reply is not an object at all.
 */
export function fitPlan(
 value:unknown,
 brief:CompositionInput,
 rules:AiComposeRules=AI_COMPOSE_RULES,
):FittedPlan|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const raw=value as Record<string,unknown>;
 const view=portrait(brief,rules);
 const range=ranges(view,rules);
 const reference=programPlan(brief,rules);
 const repairs:string[]=[];
 /** The reply's value when it is one of the allowed, else the program's. */
 const choose=<T>(name:string,given:unknown,allowed:readonly T[],fallback:T):T=>{
  if(allowed.includes(given as T))return given as T;
  repairs.push(`${name} 不在可选范围，用程序的`);
  return fallback;
 };
 const tempoGiven=typeof raw.tempo==='number'&&Number.isFinite(raw.tempo)?Math.round(raw.tempo):null;
 const tempo=tempoGiven===null?reference.tempo:Math.max(range.tempo[0],Math.min(range.tempo[1],tempoGiven));
 if(tempoGiven===null||tempo!==tempoGiven)repairs.push(`速度改到 ${range.tempo[0]}–${range.tempo[1]} 之内`);
 const metre=choose('拍子',raw.metre,range.metres,reference.metre);
 const shiftGiven=typeof raw.tonicShift==='number'&&Number.isFinite(raw.tonicShift)?Math.round(raw.tonicShift):null;
 const tonicShift=shiftGiven===null?reference.tonicShift:Math.max(range.tonicShift[0],Math.min(range.tonicShift[1],shiftGiven));
 if(shiftGiven===null||tonicShift!==shiftGiven)repairs.push('调改到可选范围之内');
 const givenProgressions=Array.isArray(raw.progressions)?raw.progressions.filter(item=>range.progressions.includes(item as string)).slice(0,2):[];
 if(!givenProgressions.length)repairs.push('和弦进行不在库里，用程序的');
 const drumsGiven=choose('鼓',raw.drums,range.drums,reference.drums);
 const drums=drumFits(drumsGiven,metre,rules)?drumsGiven:(range.drums.find(item=>drumFits(item,metre,rules))??'none');
 if(drums!==drumsGiven)repairs.push('鼓的节奏型和拍子对不上，换了一个');
 // The motif: whole numbers within the degree range, lengths on quarter beats within the range, at most `notes[1]`.
 const motif=raw.motif as Record<string,unknown>|null;
 const numbers=(list:unknown)=>Array.isArray(list)?list.filter((item):item is number=>typeof item==='number'&&Number.isFinite(item)):[];
 let degrees=numbers(motif?.degrees);
 let beats=numbers(motif?.beats);
 const n=Math.min(degrees.length,beats.length,range.notes[1]);
 degrees=degrees.slice(0,n).map(degree=>Math.max(rules.motif.degree[0],Math.min(rules.motif.degree[1],Math.round(degree))));
 beats=beats.slice(0,n).map(beat=>Math.max(range.beats[0],Math.min(range.beats[1],quarter(beat)||range.beats[0])));
 const motifOk=n>=range.notes[0];
 if(!motifOk)repairs.push('动机少于 2 个音，用程序的');
 const sectionsGiven=Array.isArray(raw.sections)?raw.sections as Record<string,unknown>[]:[];
 const sections=reference.sections.map((fallback,i)=>{
  const given=sectionsGiven[i]??{};
  const section:ComposeSection={
   density:DENSITIES.includes(given.density as Density)?given.density as Density:fallback.density,
   register:SECTION_REGISTERS.includes(given.register as SectionRegister)?given.register as SectionRegister:fallback.register,
   dynamics:DYNAMICS.includes(given.dynamics as ComposeSection['dynamics'])?given.dynamics as ComposeSection['dynamics']:fallback.dynamics,
  };
  // A quarter full of the child's sounds: the background steps back.
  if(view.sections[i]!.full&&(section.density==='busy'||section.dynamics==='loud')){
   repairs.push(`第 ${i+1} 段孩子的声音多，伴奏改稀、改轻`);
   section.density='sparse';
   section.dynamics='soft';
  }
  return section;
 });
 if(sectionsGiven.length!==4)repairs.push('段落应该是 4 段，缺的用程序的');
 if(new Set(sections.map(section=>section.register)).size===1){
  sections[2]!.register=sections[2]!.register==='mid'?'high':'mid';
  repairs.push('四段音区都一样，第 3 段换了');
 }
 const plan:ComposePlan={
  tempo,
  metre,
  mode:choose('调式',raw.mode,range.modes,reference.mode),
  tonicShift,
  progressions:givenProgressions.length?givenProgressions as string[]:reference.progressions,
  pattern:choose('伴奏音型',raw.pattern,range.patterns,reference.pattern),
  bass:choose('低音',raw.bass,range.bass,reference.bass),
  drums,
  motif:motifOk?{degrees,beats}:reference.motif,
  answer:choose('回应方式',raw.answer,COMPOSE_ANSWERS,reference.answer),
  sections,
  style:typeof raw.style==='string'&&rules.styles.some(style=>style.id===raw.style)?raw.style:reference.style,
 };
 const random=seeded(`${compositionSeed(brief)}|differ`);
 const differed=differFrom(plan,brief.previous,range,view,random,rules);
 if(differed.changed.length)repairs.push(`和上一首太像，程序又换了：${differed.changed.join('、')}`);
 return {plan:differed.plan,repairs};
}

// ----- 5. the notes -----
const REGISTER_SHIFT={low:-12,mid:0,high:12} as const;
const MIDI_LOW=36;
const MIDI_HIGH=96;
const clampMidi=(midi:number)=>Math.max(MIDI_LOW,Math.min(MIDI_HIGH,Math.round(midi)));

export type ComposedNotes={notes:BackgroundNoteData[];tempo:number;metre:Metre;tonic:number;cadenceAt:number};

/** The plan written out as the four parts of a background for this piece. */
export function composeNotes(
 brief:Pick<BackgroundBrief,'seconds'|'mood'|'sounds'>,
 plan:ComposePlan,
 rules:AiComposeRules=AI_COMPOSE_RULES,
 background:BackgroundRules=BACKGROUND_RULES,
):ComposedNotes{
 const {seconds}=brief;
 const view=portrait(brief,rules);
 const {scale}=background.modes[plan.mode];
 // AI degrees refer to the selected mode, not the old plain-background melody palette.
 const steps=plan.mode==='pentatonic'?background.modes.pentatonic.melody:scale;
 const tonic=background.moods[view.mood].tonic+plan.tonicShift;
 const beat=60/plan.tempo;
 const bar=beat*plan.metre;
 const notes:BackgroundNoteData[]=[];
 const push=(note:BackgroundNoteData)=>{
  const length=Math.min(note.length,seconds-note.at);
  if(note.at<0||note.at>=seconds-1e-6||length<=0.01)return;
  notes.push({...note,length,midi:note.part==='rhythm'?0:clampMidi(note.midi),accent:Math.max(0,Math.min(1,note.accent))});
 };
 // The ending, as the plain background: the tonic lands on the last bar line that leaves room to ring.
 const cadenceBar=Math.max(0,Math.floor((seconds-background.ending.minRingSeconds)/bar+1e-9));
 const cadenceAt=cadenceBar*bar;
 const pitch=(index:number)=>tonic+scale[((index%7)+7)%7]!+12*Math.floor(index/7);
 const triad=(degree:number)=>{
  const root=degree-1;
  const chord=[root,root+2,root+4].map(pitch);
  return scale[root]!>6?chord.map(note=>note-12):chord;
 };
 const progressions=plan.progressions.map(item=>item.split('-').map(Number));
 // A busy piece changes chord every two bars, so the background stays calm under it.
 const barsPerChord=view.density==='busy'?2:1;
 const degreeOf=(barIndex:number)=>{
  if(barIndex>=cadenceBar)return 1;
  if(barIndex===cadenceBar-1)return 5;
  const progression=progressions[barIndex>=cadenceBar/2&&progressions[1]?1:0]!;
  return progression[Math.floor(barIndex/barsPerChord)%progression.length]!;
 };
 const sectionAt=(at:number)=>plan.sections[Math.min(3,Math.floor(at/(seconds/4)))]!;
 const level=(at:number)=>rules.sections.dynamics[sectionAt(at).dynamics];

 for(let i=0;i*bar<seconds-1e-6;i++){
  const at=i*bar;
  const last=i>=cadenceBar;
  const end=last?seconds:Math.min(at+bar,seconds);
  const chord=triad(degreeOf(i));
  const accent=level(at);
  // Accompaniment.
  if(last||plan.pattern==='block'||plan.pattern==='pad'){
   for(const midi of chord)push({at,length:end-at,midi,part:'chord',accent:plan.pattern==='pad'&&!last?accent*.75:accent});
  }else if(plan.pattern==='arpeggio'){
   for(let k=0;k<plan.metre;k++){
    const tone=[0,1,2,1][k%4]!;
    push({at:at+k*beat,length:beat*.9,midi:chord[tone]!+(k%4===2?12:0),part:'chord',accent:k===0?accent:accent*.8});
   }
  }else if(plan.pattern==='ostinato'){
   const figure=[chord[0]!,chord[2]!,chord[0]!+12,chord[2]!];
   for(let k=0;k<plan.metre*2;k++)
    push({at:at+k*beat/2,length:beat/2*.85,midi:figure[k%4]!,part:'chord',accent:k%2?accent*.7:accent*.85});
  }else{
   for(let k=0;k<plan.metre;k++)for(const midi of chord)
    push({at:at+k*beat+beat/2,length:beat*.4,midi,part:'chord',accent:accent*.8});
  }
  // Bass.
  const root=chord[0]!-background.bass.dropSemitones;
  const nextRoot=triad(degreeOf(i+1))[0]!-background.bass.dropSemitones;
  if(plan.bass!=='none'){
   if(last||plan.bass==='hold')push({at,length:(end-at)*(last?1:background.bass.lengthPortion),midi:root,part:'bass',accent});
   else for(let k=0;k<plan.metre;k++){
    const midi=plan.bass==='pulse'
     ?root
     :plan.bass==='ostinato'
      ?root+(k%2?7:0)
      // Walking: chord tones, then a step towards the next chord's root on the last beat.
      :k===plan.metre-1&&nextRoot!==root?nextRoot+(nextRoot>root?-1:1):root+[0,4,7,4][k%4]!;
    push({at:at+k*beat,length:beat*.85,midi,part:'bass',accent:k===0?accent:accent*.8});
   }
  }
  // Drums.
  if(last){
   if(plan.drums!=='none')push({at:cadenceAt,length:beat,midi:0,part:'rhythm',accent:1});
  }else if(plan.drums!=='none'){
   const hits=rules.drums.patterns[plan.drums]?.[String(plan.metre)]??[];
   for(const [offset,strength] of hits)
    push({at:at+offset*beat,length:Math.min(beat,.25),midi:0,part:'rhythm',accent:strength*accent/rules.sections.dynamics.medium});
  }
 }

 // Melody: the motif only in the gaps between the child's sounds, answering the sound before each gap.
 const {liftSemitones,minGapBeats,marginSeconds,noteLengthPortion}=background.melody;
 const base=tonic+liftSemitones;
 const melodyPitch=(degree:number)=>base+steps[((degree%steps.length)+steps.length)%steps.length]!+12*Math.floor(degree/steps.length);
 const busy=mergeSpans(brief.sounds.map(sound=>({start:sound.start-marginSeconds,end:sound.end+marginSeconds})),seconds);
 const gaps:{start:number;end:number}[]=[];
 let from=0;
 for(const span of [...busy,{start:cadenceAt,end:seconds}]){
  if(span.start-from>=minGapBeats*beat)gaps.push({start:from,end:Math.min(span.start,cadenceAt)});
  from=Math.max(from,span.end);
 }
 const motifBeats=plan.motif.beats.reduce((sum,value)=>sum+value,0);
 const motifSeconds=motifBeats*beat;
 const way=Math.sign(plan.motif.degrees.at(-1)!-plan.motif.degrees[0]!);
 let phrase=0;
 for(const gap of gaps){
  const asked=[...brief.sounds].filter(sound=>sound.end<=gap.start+marginSeconds+1e-6).sort((a,b)=>a.end-b.end).at(-1);
  const section=sectionAt(gap.start);
  let shift:number=REGISTER_SHIFT[section.register];
  let degrees=plan.motif.degrees;
  let lift=0;
  if(asked){
   // 对答 moves away from the sound's register and goes the other way; 模仿 follows its way.
   if(plan.answer==='mirror'&&asked.pitch!=='mid')shift=asked.pitch==='high'?-12:12;
   const wanted=asked.contour==='rising'?1:asked.contour==='falling'?-1:0;
   const target=plan.answer==='mirror'?-wanted:wanted;
   if(target!==0&&way!==0&&target!==way)degrees=degrees.map(degree=>-degree);
   lift=asked.intensity==='loud'?.1:asked.intensity==='soft'?-.1:0;
  }
  const rest=rules.sections.rest[section.density]*motifSeconds;
  for(let t=gap.start;t+motifSeconds<=gap.end+1e-6;t+=motifSeconds+rest){
   // Every other phrase a step higher (a sequence), so the repeats travel.
   const sequence=phrase%2;
   let at=t;
   degrees.forEach((degree,i)=>{
    const length=plan.motif.beats[i]!*beat;
    push({at,length:length*noteLengthPortion,midi:melodyPitch(degree+sequence)+shift,part:'melody',
     accent:(i===0?.8:.6)*level(at)/rules.sections.dynamics.medium+lift});
    at+=length;
   });
   phrase++;
  }
 }
 // The melody lands on the tonic with the last chord when no child's sound is there.
 if(!busy.some(span=>span.start<=cadenceAt&&span.end>cadenceAt))
  push({at:cadenceAt,length:seconds-cadenceAt,midi:base+REGISTER_SHIFT[plan.sections[3]!.register],part:'melody',accent:.8});
 notes.sort((a,b)=>a.at-b.at||a.midi-b.midi);
 return {notes,tempo:plan.tempo,metre:plan.metre,tonic,cadenceAt};
}

/** 降级：程序自编 — the program's plan and its notes, when no AI step gave a background. */
export function programBackground(
 brief:CompositionInput,
 rules:AiComposeRules=AI_COMPOSE_RULES,
){
 const plan=programPlan(brief,rules);
 return {plan,...composeNotes(brief,plan,rules)};
}

/** What the model is told: the portrait, the ranges, the style card and the program's reference plan. */
export function composeView(
 brief:CompositionInput,
 rules:AiComposeRules=AI_COMPOSE_RULES,
){
 const view=portrait(brief,rules);
 const reference=programPlan(brief,rules);
 return {
  portrait:view,
  ranges:ranges(view,rules),
  style:rules.styles.find(style=>style.id===reference.style)!,
  reference,
 };
}
