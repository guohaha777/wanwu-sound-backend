// The AI backgrounds. All start from the same anonymous BackgroundBrief (the child's piece, no textbook song) and the
// program's reading of it (@wanwu-v2/sound-rules/ai-compose: portrait, ranges, style card, reference plan).
// - background-audio (AI music model): the program describes its reference plan in words; the model makes audio freely.
//   Only the audio's length and format can be checked afterwards (parseBackgroundResult).
// - background-compose (AI voice model, then AI text model): the model is the composer — it chooses inside the ranges
//   and writes a motif; the program checks the plan (fitPlan) and writes every note (composeNotes).
import {MOODS} from '@wanwu-v2/contracts/arrangement';
import {COMPOSE_ANSWERS,COMPOSE_BASS,COMPOSE_DRUMS,COMPOSE_PATTERNS,BRIGHTNESSES} from '@wanwu-v2/contracts/background';
import type {BackgroundBrief,ComposePlan} from '@wanwu-v2/contracts/background';
import {SOUND_CHOICES,SOUND_KINDS} from '@wanwu-v2/contracts/sound';
import {DENSITIES,TEXTBOOK_MODES} from '@wanwu-v2/contracts/textbook';
import {composeView,fitPlan} from '@wanwu-v2/sound-rules/ai-compose';
import type {FittedPlan} from '@wanwu-v2/sound-rules/ai-compose';
import audioFile from '../../prompts/background-audio.v2.json' with {type:'json'};
import composeFile from '../../prompts/background-compose.v1.json' with {type:'json'};
import type {Acceptance} from '../accept.ts';
import {fill} from '../fill.ts';
import {buildPrompt,loadPrompt,word} from './files.ts';
import type {PromptFile} from './files.ts';
import {readReply} from './reply.ts';

const METRES=['2','3','4'];
const round1=(value:number)=>Math.round(value*10)/10;

// ----- AI 音乐模型（描述词） -----
export const BACKGROUND_AUDIO_PROMPT=loadPrompt(audioFile as PromptFile,{
 task:'background-audio',
 model:'music',
 placeholders:['seconds','mood','tempo','metre','mode','style','accompaniment','energy','room','register'],
 templates:{room:['percent']},
 tables:{
  'words.metre':METRES,
  'words.mode':TEXTBOOK_MODES,
  'words.mood':['none',...MOODS],
  'words.energy':DENSITIES,
  'words.register':SOUND_CHOICES.pitch,
  'words.accompaniment':COMPOSE_PATTERNS,
 },
});

/** The music model hears the program's reference plan in words: mood, tempo, metre, mode, style, accompaniment, room. */
export function buildBackgroundAudio(brief:BackgroundBrief){
 const file=BACKGROUND_AUDIO_PROMPT;
 const {portrait,reference,style}=composeView(brief);
 return buildPrompt(file,{
  seconds:Math.round(brief.seconds),
  mood:word(file,'words.mood',portrait.mood),
  tempo:reference.tempo,
  metre:word(file,'words.metre',reference.metre),
  mode:word(file,'words.mode',reference.mode),
  style:style.name,
  accompaniment:word(file,'words.accompaniment',reference.pattern),
  energy:word(file,'words.energy',portrait.density),
  room:fill(file.room as string,{percent:Math.round(portrait.coverage*100)}),
  register:word(file,'words.register',portrait.register),
 });
}

// ----- AI 作曲（语音模型、文本模型） -----
type ComposeFile=PromptFile&{system:string[];soundLine:string;sectionLine:string;styleLine:string;retry:string;plan:string};
export const BACKGROUND_COMPOSE_PROMPT=loadPrompt(composeFile as ComposeFile,{
 task:'background-compose',
 model:'language',
 placeholders:['seconds','mood','density','coverage','kinds','count','lean','sounds','sections','tempoMin','tempoMax','metres',
  'modes','shiftMin','shiftMax','progressions','patterns','bass','drums','notesMin','notesMax','beatsMin','beatsMax','style',
  'reference','previous','retry'],
 templates:{
  soundLine:['n','start','end','pitch','length','contour','intensity','pattern','kind','brightness'],
  sectionLine:['name','start','end','count','full'],
  styleLine:['id','name','hint'],
  retry:['attempt'],
  'words.lean.register':['value'],
  'words.lean.contour':['value'],
  'words.lean.intensity':['value'],
  'words.lean.length':['value'],
  'words.lean.noContour':[],
  'words.first':[],
  plan:['tempo','metre','mode','tonicShift','progressions','pattern','bass','drums','degrees','beats','answer','sections','style'],
 },
 tables:{
  'words.mood':['none',...MOODS],
  'words.density':DENSITIES,
  'words.pitch':SOUND_CHOICES.pitch,
  'words.length':SOUND_CHOICES.duration,
  'words.contour':[...SOUND_CHOICES.contour,'none'],
  'words.intensity':SOUND_CHOICES.intensity,
  'words.pattern':SOUND_CHOICES.pattern,
  'words.kind':SOUND_KINDS,
  'words.brightness':BRIGHTNESSES,
  'words.full':['yes'],
  'words.section':['0','1','2','3'],
  'words.metre':METRES,
  'words.mode':TEXTBOOK_MODES,
  'words.patternName':COMPOSE_PATTERNS,
  'words.bass':COMPOSE_BASS,
  'words.drums':COMPOSE_DRUMS,
  'words.answer':COMPOSE_ANSWERS,
 },
});
if(!(composeFile as ComposeFile).system.every(line=>typeof line==='string'&&line.trim()))
 throw new Error('提示词文件有误：background-compose.system 应该是一行行的文字');

/** A plan in one line of words (the reference, and what the last background chose). */
function planLine(plan:ComposePlan){
 const file=BACKGROUND_COMPOSE_PROMPT;
 return fill(file.plan,{
  tempo:plan.tempo,
  metre:plan.metre,
  mode:plan.mode,
  tonicShift:plan.tonicShift,
  progressions:plan.progressions.join(' / '),
  pattern:plan.pattern,
  bass:plan.bass,
  drums:plan.drums,
  degrees:`[${plan.motif.degrees.join(', ')}]`,
  beats:`[${plan.motif.beats.join(', ')}]`,
  answer:plan.answer,
  sections:plan.sections.map(section=>`${section.density}/${section.register}/${section.dynamics}`).join('，'),
  style:plan.style,
 });
}

/** The composer's prompt for this piece and try; the system part adds the composer's role to the shared one. */
export function buildBackgroundCompose(brief:BackgroundBrief){
 const file=BACKGROUND_COMPOSE_PROMPT;
 const {portrait:view,ranges:range,style,reference}=composeView(brief);
 const list=(path:string,items:readonly (string|number)[])=>items.map(item=>word(file,path,item)).join('、');
 const lean=[
  fill(word(file,'words.lean','register'),{value:word(file,'words.pitch',view.register)}),
  view.contour
   ?fill(word(file,'words.lean','contour'),{value:word(file,'words.contour',view.contour)})
   :word(file,'words.lean','noContour'),
  fill(word(file,'words.lean','intensity'),{value:word(file,'words.intensity',view.intensity)}),
  fill(word(file,'words.lean','length'),{value:word(file,'words.length',view.length)}),
 ].join('；');
 const sounds=brief.sounds.map(sound=>fill(file.soundLine,{
  n:sound.n,
  start:round1(sound.start),
  end:round1(sound.end),
  pitch:word(file,'words.pitch',sound.pitch),
  length:word(file,'words.length',sound.length),
  contour:word(file,'words.contour',sound.contour??'none'),
  intensity:word(file,'words.intensity',sound.intensity),
  pattern:word(file,'words.pattern',sound.pattern),
  kind:word(file,'words.kind',sound.kind),
  brightness:word(file,'words.brightness',sound.brightness),
 })).join('\n');
 const sections=view.sections.map((section,i)=>fill(file.sectionLine,{
  name:word(file,'words.section',i),
  start:Math.round(section.start),
  end:Math.round(section.end),
  count:section.count,
  full:section.full?word(file,'words.full','yes'):'',
 })).join('\n');
 const built=buildPrompt(file,{
  seconds:Math.round(brief.seconds),
  mood:word(file,'words.mood',view.mood),
  density:word(file,'words.density',view.density),
  coverage:Math.round(view.coverage*100),
  kinds:view.kinds,
  count:view.count,
  lean,
  sounds,
  sections,
  tempoMin:range.tempo[0],
  tempoMax:range.tempo[1],
  metres:list('words.metre',range.metres),
  modes:list('words.mode',range.modes),
  shiftMin:range.tonicShift[0],
  shiftMax:range.tonicShift[1],
  progressions:range.progressions.join('、'),
  patterns:list('words.patternName',range.patterns),
  bass:list('words.bass',range.bass),
  drums:list('words.drums',range.drums),
  notesMin:range.notes[0],
  notesMax:range.notes[1],
  beatsMin:range.beats[0],
  beatsMax:range.beats[1],
  style:fill(file.styleLine,{id:style.id,name:style.name,hint:style.hint}),
  reference:planLine(reference),
  previous:brief.previous?planLine(brief.previous):word(file,'words','first'),
  retry:brief.attempt>0?fill(file.retry,{attempt:brief.attempt+1}):'',
 });
 return {...built,system:[built.system,...(file as ComposeFile).system].filter(Boolean).join('\n')};
}

/**
 * A composer's reply checked against this piece: the plan the program will play (choices outside the ranges replaced,
 * full quarters kept quiet, a 换一首 that changed too little changed further). Rejected only when it is not a JSON
 * object; `partly` when the program had to repair something (each repair in `notes`).
 */
export function readBackgroundCompose(text:string,brief:BackgroundBrief){
 const read=readReply(text);
 if('problem' in read)return {repairs:read.repairs,acceptance:{status:'rejected',value:null,notes:[read.problem]} as Acceptance<FittedPlan|null>};
 const fitted=fitPlan(read.value,brief);
 const acceptance:Acceptance<FittedPlan|null>=fitted
  ?{status:fitted.repairs.length?'partly':'accepted',value:fitted,notes:fitted.repairs}
  :{status:'rejected',value:null,notes:['回复不是 JSON 对象']};
 return {repairs:read.repairs,acceptance};
}
