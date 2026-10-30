// ----- 课本特征卡（教学音乐上传后自动生成；也用于内置歌） -----
// The program measures the recording (@wanwu-v2/music-features); an audio model listens to a short excerpt (or, when
// it cannot, a language model reads only the numbers) and chooses the characteristic rhythm, checks the metre and the
// tempo, picks a mood and writes a line for children and a plain note for teachers. Every answer is checked here, the
// same way on the server and in the prompt lab; anything that fails falls back to the program's own choice.
import {MOODS} from '@wanwu-v2/contracts/arrangement';
import type {MoodId} from '@wanwu-v2/contracts/arrangement';
import {BRIGHTNESSES,DENSITIES,TEXTBOOK_MODES} from '@wanwu-v2/contracts/textbook';
import type {Brightness,Density,Metre,TextbookMode} from '@wanwu-v2/contracts/textbook';
import featuresFile from '../../prompts/textbook-features.v1.json' with {type:'json'};
import type {Acceptance} from '../accept.ts';
import {lineProblems} from '../accept.ts';
import {fill} from '../fill.ts';
import {STYLE} from '../style.ts';
import {buildPrompt,exampleJson,loadPrompt,word} from './files.ts';
import type {PromptFile} from './files.ts';
import {readReply} from './reply.ts';

export type TextbookFeaturesBrief={
 title:string;
 /** Seconds of audio attached for the model to hear; 0 when only the numbers are sent. */
 listenSeconds:number;
 tempoBpm:number;meter:Metre;meterConfidence:number;mode:TextbookMode;onsetDensity:Density;brightness:Brightness;
 /** Recurring bar patterns the program found (beats), and the one it would choose itself. */
 candidates:readonly {cell:readonly number[];bars:number}[];fallbackCell:readonly number[];
 others:readonly {title:string;rhythmCell:readonly number[];childLine:string}[];
};
export type TextbookFeatures={rhythmCell:number[];meter:Metre;tempoBpm:number;mood:MoodId;childLine:string|null;teacherNote:string|null};

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
export function isTextbookFeaturesBrief(value:unknown):value is TextbookFeaturesBrief{
 if(!value||typeof value!=='object')return false;
 const raw=value as Record<string,unknown>,cell=(list:unknown)=>Array.isArray(list)&&list.length>0&&list.length<=16&&list.every(n=>finite(n)&&n>=.25&&n<=4);
 return typeof raw.title==='string'&&[...raw.title.trim()].length>=1&&[...raw.title].length<=24&&finite(raw.listenSeconds)&&raw.listenSeconds>=0&&raw.listenSeconds<=60
  &&finite(raw.tempoBpm)&&raw.tempoBpm>=40&&raw.tempoBpm<=220&&[2,3,4].includes(raw.meter as number)&&finite(raw.meterConfidence)
  &&TEXTBOOK_MODES.includes(raw.mode as TextbookMode)&&DENSITIES.includes(raw.onsetDensity as Density)&&BRIGHTNESSES.includes(raw.brightness as Brightness)
  &&Array.isArray(raw.candidates)&&raw.candidates.length<=8&&raw.candidates.every(item=>item&&cell(item.cell)&&Number.isInteger(item.bars))&&cell(raw.fallbackCell)
  &&Array.isArray(raw.others)&&raw.others.length<=50&&raw.others.every(item=>item&&typeof item.title==='string'&&cell(item.rhythmCell)&&typeof item.childLine==='string');
}

export const TEXTBOOK_FEATURES_PROMPT=loadPrompt(featuresFile as PromptFile,{
 task:'textbook-features',model:'audio',
 placeholders:['title','listen','tempo','metre','metreSure','mode','density','brightness','candidates','others','moods','childLineMax','noteMax','example'],
 templates:{candidateLine:['cell','bars'],otherLine:['title','rhythm','childLine'],'words.listen.audio':['seconds'],'words.listen.numbers':[],'words.noCandidates':[],'words.noOthers':[]},
 tables:{'words.metre':['2','3','4'],'words.sure':['high','low'],'words.mode':TEXTBOOK_MODES,'words.density':DENSITIES,'words.brightness':BRIGHTNESSES,'words.mood':MOODS},
 example:value=>{const result=acceptTextbookFeatures(value,{tempoBpm:96,meter:2,fallbackCell:[1,1]});return result.status==='accepted'?[]:result.notes;},
});

export function buildTextbookFeatures(brief:TextbookFeaturesBrief){
 const file=TEXTBOOK_FEATURES_PROMPT;
 const candidates=brief.candidates.map(item=>fill(file.candidateLine as string,{cell:item.cell.join(', '),bars:item.bars})).join('；')||word(file,'words','noCandidates');
 const others=brief.others.filter(other=>other.title!==brief.title)
  .map(other=>fill(file.otherLine as string,{title:other.title,rhythm:other.rhythmCell.join(', '),childLine:other.childLine})).join('；')||word(file,'words','noOthers');
 return buildPrompt(file,{
  title:brief.title.trim(),
  listen:brief.listenSeconds>0?fill(word(file,'words.listen','audio'),{seconds:Math.round(brief.listenSeconds)}):word(file,'words.listen','numbers'),
  tempo:Math.round(brief.tempoBpm),metre:word(file,'words.metre',brief.meter),metreSure:word(file,'words.sure',brief.meterConfidence>=.3?'high':'low'),
  mode:word(file,'words.mode',brief.mode),density:word(file,'words.density',brief.onsetDensity),brightness:word(file,'words.brightness',brief.brightness),
  candidates,others,moods:MOODS.map(mood=>`${mood}=${word(file,'words.mood',mood)}`).join('，'),
  childLineMax:STYLE.slots.childLine.maxChars,noteMax:STYLE.slots.explain.maxChars,example:exampleJson(file),
 });
}

/**
 * Checks a reply. Mood is required (else the reply is refused); a rhythm that is not a valid bar of the chosen metre
 * falls back to the program's choice; tempo may only be halved or doubled; each sentence passes the style check or is
 * dropped (null) for the page to leave out.
 */
export function acceptTextbookFeatures(reply:unknown,brief:Pick<TextbookFeaturesBrief,'tempoBpm'|'meter'|'fallbackCell'>):Acceptance<TextbookFeatures|null>{
 const raw=reply&&typeof reply==='object'?reply as Record<string,unknown>:null;
 if(!raw)return {status:'rejected',value:null,notes:['回复不是 JSON 对象']};
 if(!MOODS.includes(raw.mood as MoodId))return {status:'rejected',value:null,notes:[`mood 只能是 ${MOODS.join(' / ')}`]};
 const notes:string[]=[];
 const meter:Metre=[2,3,4].includes(raw.meter as number)?raw.meter as Metre:brief.meter;
 if(meter!==raw.meter)notes.push('meter 不认识，用程序测的');
 let rhythmCell=Array.isArray(raw.rhythmCell)?raw.rhythmCell.filter(finite).map(n=>Math.max(.25,Math.min(4,Math.round(n*4)/4))):[];
 const total=rhythmCell.reduce((sum,n)=>sum+n,0);
 if(!rhythmCell.length||rhythmCell.length>16||Math.abs(total-meter)>1e-6){
  notes.push(`rhythmCell 加起来不是一小节（${meter} 拍），用程序选的`);
  const fallbackTotal=brief.fallbackCell.reduce((sum,n)=>sum+n,0);
  rhythmCell=Math.abs(fallbackTotal-meter)<1e-6?[...brief.fallbackCell]:new Array<number>(meter).fill(1);
 }
 const factor=raw.tempo==='half'?.5:raw.tempo==='double'?2:1;
 if(!['half','double','same'].includes(raw.tempo as string))notes.push('tempo 不认识，按 same');
 const tempoBpm=Math.max(40,Math.min(200,Math.round(brief.tempoBpm*factor)));
 const sentence=(value:unknown,slot:'childLine'|'explain',name:string)=>{
  if(typeof value!=='string'){notes.push(`缺少 ${name}`);return null;}
  const text=value.trim().replace(slot==='childLine'?/[。！!.]$/:/$^/,'');
  const problems=lineProblems(text,slot,[],slot==='childLine'?[]:[...rhythmCell,meter,tempoBpm,1,2,3,4]);
  if(problems.length){notes.push(`${name}：${problems.join('；')}`);return null;}
  return text;
 };
 const childLine=sentence(raw.childLine,'childLine','childLine'),teacherNote=sentence(raw.teacherNote,'explain','teacherNote');
 return {status:notes.length?'partly':'accepted',value:{rhythmCell,meter,tempoBpm,mood:raw.mood as MoodId,childLine,teacherNote},notes};
}

export function readTextbookFeatures(text:string,brief:Pick<TextbookFeaturesBrief,'tempoBpm'|'meter'|'fallbackCell'>){
 const read=readReply(text);
 return {repairs:read.repairs,acceptance:'problem' in read?{status:'rejected' as const,value:null,notes:[read.problem]}:acceptTextbookFeatures(read.value,brief)};
}
