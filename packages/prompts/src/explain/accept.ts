// The model's part of the card (inside a textbook-features reply), checked field by field. A field that fails becomes
// null, and the card uses the corpus line for that row instead — the rest of the reply is still used.
// - title and child lines: their limits, no terms, no numbers;
// - each row must be about its point (one of the point's keywords), 动一动 must name a movement and, when its point is
//   the bar, say the action words exactly as the program says them;
// - rows about the bar are dropped when the bar is not the model's own;
// - a line too like another song's, an example's or an earlier row's (or opening the same way) is dropped.
import {lineProblems} from '../accept.ts';
import type {Slot} from '../style.ts';
import {EXPLAIN,ROWS,cardTerms} from './corpus.ts';
import type {ExplainCorpus,Row} from './corpus.ts';
import {onBar,pointKeywords} from './points.ts';
import type {Points} from './points.ts';
import {actionWords} from './rhythm.ts';

export type ExplainReply={
 title:string|null;
 sound:string|null;
 listen:string|null;
 move:string|null;
 play:string|null;
 highlight:string[];
 teacher:{listen:string|null;move:string|null;play:string|null};
};
export const EMPTY_EXPLAIN:ExplainReply={
 title:null,
 sound:null,
 listen:null,
 move:null,
 play:null,
 highlight:[],
 teacher:{listen:null,move:null,play:null},
};

/** Share of character pairs two lines have in common (0–1), punctuation and spaces ignored. */
export function similarity(a:string,b:string){
 /** The set of neighbouring character pairs of a line. */
 const pairs=(s:string)=>{
  const t=[...s.replace(/[\s\p{P}]/gu,'')];
  const set=new Set<string>();
  for(let i=0;i+1<t.length;i++)set.add(t[i]!+t[i+1]!);
  return set;
 };
 const x=pairs(a);
 const y=pairs(b);
 if(!x.size||!y.size)return 0;
 let same=0;
 for(const pair of x)if(y.has(pair))same++;
 return same/(x.size+y.size-same);
}

/**
 * What a reply is checked against: the card's points and bar, whether the bar is the model's, and lines it must not
 * copy.
 */
export type ExplainCheck={
 points:Points;
 rhythmCell:readonly number[];
 numbers:readonly number[];
 own:boolean;
 others:readonly string[];
};

export function acceptExplain(
 value:unknown,
 check:ExplainCheck,
 corpus:ExplainCorpus=EXPLAIN,
):{value:ExplainReply;notes:string[]}{
 const notes:string[]=[];
 if(!value||typeof value!=='object')
  return {value:EMPTY_EXPLAIN,notes:value===undefined?[]:['explain 不是对象，讲解卡用语料']};
 const raw=value as Record<string,unknown>;
 const teacher=raw.teacher&&typeof raw.teacher==='object'?raw.teacher as Record<string,unknown>:{};
 /** One sentence, checked for its slot (child lines also for music words); null when missing or failed. */
 const text=(field:unknown,name:string,slot:Slot,numbers:readonly number[])=>{
  if(field===undefined||field===null)return null;
  if(typeof field!=='string'){
   notes.push(`explain.${name} 不是一句话`);
   return null;
  }
  const said=field.trim().replace(slot==='cardTitle'?/[。！!.，,]$/:/$^/,'');
  const problems=[...lineProblems(said,slot,[],numbers),...(slot==='teacherLine'?[]:cardTerms(said,corpus))];
  if(problems.length){
   notes.push(`explain.${name}：${problems.join('；')}`);
   return null;
  }
  return said;
 };
 const drop=(name:string,why:string)=>{
  notes.push(`explain.${name} ${why}，用语料`);
  return null;
 };
 const squeeze=(s:string)=>s.replace(/\s+/g,'');
 const actions=actionWords(check.rhythmCell,corpus);
 const kept:string[]=[];
 const child={} as Record<Row,string|null>;
 // The child's three lines, each dropped (to the corpus line) at the first check it fails.
 for(const row of ROWS){
  const point=check.points[row];
  let line=text(raw[row],row,'cardLine',[]);
  if(line&&!check.own&&onBar(point))line=drop(row,'讲的是节奏，节奏换成了程序的');
  if(line&&!pointKeywords(point,corpus).some(word=>line!.includes(word)))
   line=drop(row,`没有讲到要点「${corpus.teacherWords[point.feature]?.[point.value]}」`);
  if(line&&row==='move'&&!corpus.moves.some(word=>line!.includes(word)))line=drop(row,'没有身体动作');
  if(line&&row==='move'&&point.feature==='rhythm'&&!squeeze(line).includes(squeeze(actions)))
   line=drop(row,`没有照着说「${actions}」`);
  if(line&&kept.some(other=>[...other].slice(0,2).join('')===[...line!].slice(0,2).join('')))
   line=drop(row,'和前一栏开头一样');
  if(line&&[...kept,...check.others].some(other=>similarity(other,line!)>corpus.points.similarAbove))
   line=drop(row,'和别的句子太像');
  if(line)kept.push(line);
  child[row]=line;
 }
 const teacherLine=(row:Row)=>{
  const line=text(teacher[row],`teacher.${row}`,'teacherLine',check.numbers);
  return line&&!check.own&&onBar(check.points[row])
   ?drop(`teacher.${row}`,'讲的是节奏，节奏换成了程序的')
   :line;
 };
 const sound=typeof raw.sound==='string'&&raw.sound in corpus.sounds?raw.sound:null;
 if(raw.sound!==undefined&&!sound)
  notes.push(`explain.sound 只能是 ${Object.keys(corpus.sounds).join(' / ')}`);
 const reply:ExplainReply={
  title:text(raw.title,'title','cardTitle',[]),
  sound,
  ...child,
  highlight:[],
  teacher:{listen:teacherLine('listen'),move:teacherLine('move'),play:teacherLine('play')},
 };
 // At most two highlighted words, each short and in a line that was kept.
 if(Array.isArray(raw.highlight))for(const word of raw.highlight.slice(0,2)){
  if(typeof word==='string'
   &&word.trim()
   &&[...word.trim()].length<=6
   &&kept.some(line=>line.includes(word.trim())))reply.highlight.push(word.trim());
  else notes.push(`explain.highlight「${String(word)}」不在句子里，不加粗`);
 }
 return {value:reply,notes};
}

/** Whether a stored reply has the explain shape (the page checks before it trusts what it kept). */
export function isExplainReply(value:unknown):value is ExplainReply{
 if(!value||typeof value!=='object')return false;
 const raw=value as Record<string,unknown>;
 const t=raw.teacher as Record<string,unknown>|null;
 const line=(v:unknown)=>v===null||typeof v==='string';
 return line(raw.title)
  &&line(raw.sound)
  &&line(raw.listen)
  &&line(raw.move)
  &&line(raw.play)
  &&Array.isArray(raw.highlight)
  &&raw.highlight.every(w=>typeof w==='string')
  &&!!t
  &&typeof t==='object'
  &&line(t.listen)
  &&line(t.move)
  &&line(t.play);
}
