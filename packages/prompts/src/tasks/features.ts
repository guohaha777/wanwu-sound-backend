// ----- 课本特征卡（教学音乐上传后自动生成；也用于内置歌） -----
// The program measures the recording (@wanwu-v2/music-features); an audio model listens to a short excerpt (or, when
// it cannot, a language model reads only the numbers) and chooses the characteristic rhythm, checks the metre and the
// tempo, picks a mood and writes a line for children and a plain note for teachers. Every answer is checked here, the
// same way on the server and in the prompt lab; anything that fails falls back to the program's own choice.
import {MOODS} from '@wanwu-v2/contracts/arrangement';
import type {MoodId} from '@wanwu-v2/contracts/arrangement';
import {BRIGHTNESSES,DENSITIES,TEXTBOOK_MODES} from '@wanwu-v2/contracts/textbook';
import {LEVELS} from '@wanwu-v2/contracts/textbook';
import type {Brightness,Density,Level,Metre,TextbookMode} from '@wanwu-v2/contracts/textbook';
import featuresFile from '../../prompts/textbook-features.v1.json' with {type:'json'};
import type {Acceptance} from '../accept.ts';
import {lineProblems} from '../accept.ts';
import {fill} from '../fill.ts';
import {STYLE} from '../style.ts';
import {
 EMPTY_EXPLAIN,EXPLAIN_LIMITS,acceptExplain,actionWords,explainPoints,pointKeywords,pointWord,soundsForPrompt,
} from '../explain/index.ts';
import type {ExplainReply,PointFeatures} from '../explain/index.ts';
import explainSystemFile from '../../prompts/explain-system.v1.json' with {type:'json'};
import {buildPrompt,exampleJson,loadPrompt,word} from './files.ts';
import type {PromptFile} from './files.ts';
import {readReply} from './reply.ts';

export type TextbookFeaturesBrief={
 title:string;
 /** Seconds of audio attached for the model to hear; 0 when only the numbers are sent. */
 listenSeconds:number;
 tempoBpm:number;
 meter:Metre;
 meterConfidence:number;
 mode:TextbookMode;
 onsetDensity:Density;
 brightness:Brightness;
 /** Recurring bar patterns the program found (beats), and the one it would choose itself. */
 candidates:readonly {cell:readonly number[];bars:number}[];
 fallbackCell:readonly number[];
 others:readonly {title:string;rhythmCell:readonly number[];childLine:string}[];
 /** For the explanation card's points (optional for older pages: a middle register, medium repetition, a steady beat). */
 pitchRange?:{low:number;high:number};
 repetition?:Level;
 pulse?:'even'|'none';
 /** Card lines other songs already use: a new card may not copy them. */
 otherLines?:readonly string[];
};
/** `explain`: the explanation card's sentences (../explain.ts), each checked on its own; a failed one is null (the corpus line). */
export type TextbookFeatures={
 rhythmCell:number[];
 meter:Metre;
 tempoBpm:number;
 mood:MoodId;
 childLine:string|null;
 teacherNote:string|null;
 explain:ExplainReply;
};
/** From this metre confidence the program counts as sure: the prompt says so, and the model may not change the metre. */
export const METRE_SURE=.3;
type AcceptBrief=Pick<TextbookFeaturesBrief,
 'tempoBpm'|'meter'|'meterConfidence'|'listenSeconds'|'fallbackCell'|'candidates'>
 &Partial<Pick<TextbookFeaturesBrief,
  'onsetDensity'|'brightness'|'mode'|'pitchRange'|'repetition'|'pulse'|'otherLines'>>;
/** The explanation card's points from what the brief says (the same features the page's card is built from). */
const briefPoints=(
 brief:AcceptBrief,
 bar:{rhythmCell:readonly number[];meter:Metre;tempoBpm:number},
)=>explainPoints({
 tempoBpm:bar.tempoBpm,
 meter:bar.meter,
 rhythmCell:[...bar.rhythmCell],
 onsetDensity:brief.onsetDensity??'medium',
 pitchRange:brief.pitchRange??{low:60,high:74},
 brightness:brief.brightness??'mid',
 mode:brief.mode??'major',
 repetition:brief.repetition??'medium',
 ...(brief.pulse?{pulse:brief.pulse}:{}),
} satisfies PointFeatures);

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
export function isTextbookFeaturesBrief(value:unknown):value is TextbookFeaturesBrief{
 if(!value||typeof value!=='object')return false;
 const raw=value as Record<string,unknown>;
 /** A rhythm: 1–16 beat lengths of ¼ to 4 beats. */
 const cell=(list:unknown)=>Array.isArray(list)
  &&list.length>0
  &&list.length<=16
  &&list.every(n=>finite(n)&&n>=.25&&n<=4);
 return typeof raw.title==='string'
  &&[...raw.title.trim()].length>=1
  &&[...raw.title].length<=24
  &&finite(raw.listenSeconds)
  &&raw.listenSeconds>=0
  &&raw.listenSeconds<=60
  &&finite(raw.tempoBpm)
  &&raw.tempoBpm>=40
  &&raw.tempoBpm<=220
  &&[2,3,4].includes(raw.meter as number)
  &&finite(raw.meterConfidence)
  &&TEXTBOOK_MODES.includes(raw.mode as TextbookMode)
  &&DENSITIES.includes(raw.onsetDensity as Density)
  &&BRIGHTNESSES.includes(raw.brightness as Brightness)
  &&Array.isArray(raw.candidates)
  &&raw.candidates.length<=8
  &&raw.candidates.every(item=>item&&cell(item.cell)&&Number.isInteger(item.bars))
  &&cell(raw.fallbackCell)
  &&Array.isArray(raw.others)
  &&raw.others.length<=50
  &&raw.others.every(item=>item
   &&typeof item.title==='string'
   &&cell(item.rhythmCell)
   &&typeof item.childLine==='string')
  // Optional fields (older pages do not send them).
  &&(raw.pitchRange===undefined
   ||(!!raw.pitchRange
    &&typeof raw.pitchRange==='object'
    &&finite((raw.pitchRange as Record<string,unknown>).low)
    &&finite((raw.pitchRange as Record<string,unknown>).high)))
  &&(raw.repetition===undefined||LEVELS.includes(raw.repetition as Level))
  &&(raw.pulse===undefined||raw.pulse==='even'||raw.pulse==='none')
  &&(raw.otherLines===undefined
   ||(Array.isArray(raw.otherLines)
    &&raw.otherLines.length<=90
    &&raw.otherLines.every(line=>typeof line==='string'&&line.length<=60)));
}

/** The prompt's sample sentences: shown to the model for variety, never to be copied (a line too like one is dropped). */
const SAMPLES:readonly string[]=(featuresFile.words as {samples?:string[]}).samples??[];
/** The fixed principles of the explanation card (a music teacher's view), sent with the shared system prompt. */
export const EXPLAIN_SYSTEM_PROMPT=loadPrompt(explainSystemFile as PromptFile,{
 task:'explain-system',
 model:'audio',
 placeholders:[],
});
/** A plain brief the prompt's example reply is checked against. */
const EXAMPLE_BRIEF:AcceptBrief={
 tempoBpm:96,
 meter:2,
 meterConfidence:.1,
 listenSeconds:30,
 fallbackCell:[1,1],
 candidates:[],
 onsetDensity:'medium',
 brightness:'mid',
 mode:'major',
 pitchRange:{low:60,high:76},
 repetition:'medium',
};

export const TEXTBOOK_FEATURES_PROMPT=loadPrompt(featuresFile as PromptFile,{
 task:'textbook-features',
 model:'audio',
 placeholders:[
  'title','listen','tempo','metre','metreSure','mode','density','brightness','candidates','others','moods',
  'childLineMax','noteMax','sounds','cardTitleMax','cardLineMax','teacherLineMax',
  'listenPoint','listenWords','movePoint','moveWords','moveBar','playPoint','playWords','samples','example',
 ],
 templates:{
  candidateLine:['cell','say','action','bars'],
  otherLine:['title','rhythm','childLine'],
  'words.listen.audio':['seconds'],
  'words.listen.numbers':['fallback'],
  'words.moveBar':['action'],
  'words.noCandidates':[],
  'words.noOthers':[],
 },
 tables:{
  'words.beats':['0.25','0.5','0.75','1','1.5','2','3','4'],
  'words.metre':['2','3','4'],
  'words.sure':['high','low'],
  'words.mode':TEXTBOOK_MODES,
  'words.density':DENSITIES,
  'words.brightness':BRIGHTNESSES,
  'words.mood':MOODS,
 },
 // The example reply must pass the checks with nothing to note.
 example:value=>{
  const result=acceptTextbookFeatures(value,EXAMPLE_BRIEF);
  return result.status==='accepted'&&!result.notes.length?[]:result.notes;
 },
});

export function buildTextbookFeatures(brief:TextbookFeaturesBrief){
 const file=TEXTBOOK_FEATURES_PROMPT;
 // Each candidate also in words (短 / 稍长 / 一拍 …), so the teacher's note can follow it without reading numbers.
 const beatWords=['0.25','0.5','0.75','1','1.5','2','3','4'] as const;
 /** The nearest of the word table's beat lengths. */
 const say=(beats:number)=>word(file,'words.beats',beatWords.reduce((best,key)=>
  Math.abs(Number(key)-beats)<Math.abs(Number(best)-beats)?key:best));
 const candidates=brief.candidates
  .map(item=>fill(file.candidateLine as string,{
   cell:item.cell.join(', '),
   say:item.cell.map(say).join(' '),
   action:actionWords(item.cell),
   bars:item.bars,
  }))
  .join('；')
  ||word(file,'words','noCandidates');
 const others=brief.others
  .filter(other=>other.title!==brief.title)
  .map(other=>fill(file.otherLine as string,{
   title:other.title,
   rhythm:other.rhythmCell.join(', '),
   childLine:other.childLine,
  }))
  .join('；')
  ||word(file,'words','noOthers');
 const points=briefPoints(brief,{rhythmCell:brief.fallbackCell,meter:brief.meter,tempoBpm:brief.tempoBpm});
 const words=(row:'listen'|'move'|'play')=>pointKeywords(points[row]).join('、');
 const built=buildPrompt(file,{
  title:brief.title.trim(),
  // With audio: how many seconds the model hears; without: the program's rhythm to go by.
  listen:brief.listenSeconds>0
   ?fill(word(file,'words.listen','audio'),{seconds:Math.round(brief.listenSeconds)})
   :fill(word(file,'words.listen','numbers'),{fallback:brief.fallbackCell.join(', ')}),
  tempo:Math.round(brief.tempoBpm),
  metre:word(file,'words.metre',brief.meter),
  metreSure:word(file,'words.sure',brief.meterConfidence>=METRE_SURE?'high':'low'),
  mode:word(file,'words.mode',brief.mode),
  density:word(file,'words.density',brief.onsetDensity),
  brightness:word(file,'words.brightness',brief.brightness),
  candidates,
  others,
  moods:MOODS.map(mood=>`${mood}=${word(file,'words.mood',mood)}`).join('，'),
  childLineMax:STYLE.slots.childLine.maxChars,
  noteMax:STYLE.slots.explain.maxChars,
  sounds:soundsForPrompt(),
  cardTitleMax:EXPLAIN_LIMITS.title,
  cardLineMax:EXPLAIN_LIMITS.child,
  teacherLineMax:EXPLAIN_LIMITS.teacher,
  listenPoint:pointWord(points.listen),
  listenWords:words('listen'),
  movePoint:pointWord(points.move),
  moveWords:words('move'),
  moveBar:points.move.feature==='rhythm'?fill(word(file,'words','moveBar'),{action:actionWords(brief.fallbackCell)}):'',
  playPoint:pointWord(points.play),
  playWords:words('play'),
  samples:SAMPLES.join(' / '),
  example:exampleJson(file),
 });
 return {...built,system:[built.system,...EXPLAIN_SYSTEM_PROMPT.lines].filter(Boolean).join('\n')};
}


/**
 * Checks a reply. Mood is required (else the reply is refused). Rhythm, metre and tempo are taken only from a model that
 * heard the music: without audio they stay the program's. The metre may change only when the program was not sure, and
 * only together with a rhythm that fills a bar of it; otherwise the measured metre stays, with the model's rhythm if it
 * fits that metre and is one the program found in the recording (a candidate), else the program's choice — the model
 * picks among what is really there, it does not invent a bar. Tempo may only be halved or doubled. When the rhythm or
 * metre is not the
 * model's own, its teacher's note (which walks through its bar) is dropped. Each sentence passes the style check or is
 * dropped (null) for the page to leave out.
 */
export function acceptTextbookFeatures(reply:unknown,brief:AcceptBrief):Acceptance<TextbookFeatures|null>{
 const raw=reply&&typeof reply==='object'?reply as Record<string,unknown>:null;
 if(!raw)return {status:'rejected',value:null,notes:['回复不是 JSON 对象']};
 if(!MOODS.includes(raw.mood as MoodId))
  return {status:'rejected',value:null,notes:[`mood 只能是 ${MOODS.join(' / ')}`]};
 const notes:string[]=[];
 const heard=brief.listenSeconds>0;
 /** A rhythm that fills exactly `beats` beats. */
 const fills=(cell:readonly number[],beats:number)=>cell.length>0
  &&cell.length<=16
  &&Math.abs(cell.reduce((sum,n)=>sum+n,0)-beats)<1e-6;
 // The model's rhythm, each length rounded to a quarter beat within ¼–4.
 const asked=Array.isArray(raw.rhythmCell)
  ?raw.rhythmCell.filter(finite).map(n=>Math.max(.25,Math.min(4,Math.round(n*4)/4)))
  :[];
 const askedMeter=[2,3,4].includes(raw.meter as number)?raw.meter as Metre:null;
 if(!askedMeter)notes.push('meter 不认识，用程序测的');
 let meter=brief.meter,rhythmCell:number[];
 if(!heard){
  rhythmCell=[...brief.fallbackCell];
 }
 else{
  if(askedMeter&&askedMeter!==brief.meter){
   if(brief.meterConfidence>=METRE_SURE)notes.push(`程序确定是 ${brief.meter} 拍，不改`);
   else if(!fills(asked,askedMeter))notes.push(`改成 ${askedMeter} 拍但 rhythmCell 不是一小节，拍子用程序测的`);
   else meter=askedMeter;
  }
  const same=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((n,i)=>n===b[i]);
  // The candidates are bars of the measured metre; a new metre's bar cannot be among them.
  const found=meter!==brief.meter
   ||!brief.candidates.length
   ||same(asked,brief.fallbackCell)
   ||brief.candidates.some(item=>same(item.cell,asked));
  if(fills(asked,meter)&&found)rhythmCell=asked;
  else if(fills(asked,meter)){
   notes.push('rhythmCell 不在程序找到的候选里，用程序选的');
   rhythmCell=fills(brief.fallbackCell,meter)?[...brief.fallbackCell]:new Array<number>(meter).fill(1);
  }
  else{
   notes.push(`rhythmCell 不是一小节（${meter} 拍），用程序选的`);
   rhythmCell=fills(brief.fallbackCell,meter)?[...brief.fallbackCell]:new Array<number>(meter).fill(1);
  }
 }
 // Without audio the tempo stays the program's.
 const factor=heard
  ?raw.tempo==='half'
   ?.5
   :raw.tempo==='double'
    ?2
    :1
  :1;
 if(!['half','double','same'].includes(raw.tempo as string))notes.push('tempo 不认识，按 same');
 const tempoBpm=Math.max(40,Math.min(200,Math.round(brief.tempoBpm*factor)));
 /** One sentence, checked for its slot; null (and a note) when it fails. */
 const sentence=(value:unknown,slot:'childLine'|'explain',name:string)=>{
  if(typeof value!=='string'){
   notes.push(`缺少 ${name}`);
   return null;
  }
  // The child's line may end without its full stop.
  const text=value.trim().replace(slot==='childLine'?/[。！!.]$/:/$^/,'');
  const problems=lineProblems(text,slot,[],slot==='childLine'?[]:[...rhythmCell,meter,tempoBpm,1,2,3,4]);
  if(problems.length){
   notes.push(`${name}：${problems.join('；')}`);
   return null;
  }
  return text;
 };
 // The teacher's note walks through the model's own bar; once the rhythm or metre is the program's, it no longer fits.
 const replaced=meter!==askedMeter
  ||rhythmCell.length!==asked.length
  ||rhythmCell.some((n,i)=>n!==asked[i]);
 if(replaced&&typeof raw.teacherNote==='string')notes.push('节奏或拍子换成了程序的，teacherNote 对不上，不用');
 const childLine=sentence(raw.childLine,'childLine','childLine');
 const teacherNote=replaced?null:sentence(raw.teacherNote,'explain','teacherNote');
 // The explanation card: its own checks; a failed field becomes the corpus line on the page and does not make the
 // features 'partly' (those are about the numbers).
 const explain=heard||raw.explain!==undefined
  ?acceptExplain(raw.explain,{
   points:briefPoints(brief,{rhythmCell,meter,tempoBpm}),
   rhythmCell,
   numbers:[...rhythmCell,meter,tempoBpm,1,2,3,4],
   own:!replaced,
   others:[...(brief.otherLines??[]),...SAMPLES],
  })
  :{value:EMPTY_EXPLAIN,notes:[]};
 return {
  status:notes.length?'partly':'accepted',
  value:{rhythmCell,meter,tempoBpm,mood:raw.mood as MoodId,childLine,teacherNote,explain:explain.value},
  notes:[...notes,...explain.notes],
 };
}

export function readTextbookFeatures(text:string,brief:AcceptBrief){
 const read=readReply(text);
 return {
  repairs:read.repairs,
  acceptance:'problem' in read
   ?{status:'rejected' as const,value:null,notes:[read.problem]}
   :acceptTextbookFeatures(read.value,brief),
 };
}
