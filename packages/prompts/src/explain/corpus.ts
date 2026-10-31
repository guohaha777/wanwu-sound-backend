// 讲解卡语料 (corpus/explain.v2.json): the words of the explanation card and the numbers that choose what it talks
// about. Everything a music teacher may want to tune lives in the file — the onomatopoeia library, the action words,
// the sentence bank (row × feature × value, three or more each), the keywords that show a sentence is about its point,
// the teacher's lines, and the weights that decide which feature each row talks about (`points`). The file is checked
// when loaded, so a bad edit fails the tests, never a page.
import explainFile from '../../corpus/explain.v2.json' with {type:'json'};
import {fill,unknownPlaceholders} from '../fill.ts';
import {wordProblems} from '../style.ts';
import type {Slot} from '../style.ts';

export const ROWS=['listen','move','play'] as const;
export type Row=typeof ROWS[number];
/** Every feature a row may talk about, and its values. */
export const FEATURE_VALUES={
 tempo:['fast','slow','medium'],brightness:['bright','dark','mid'],register:['high','low','mid'],density:['busy','sparse','medium'],
 mode:['major','minor','pentatonic','dorian'],repetition:['high','low','medium'],metre:['2','3','4','free','even'],
 rhythm:['dotted','long','running','plain'],longNote:['start','end','middle','none'],
} as const;
export type Feature=keyof typeof FEATURE_VALUES;
export type FactSource='textbook'|'measured'|'ai'|'example';
type Bank=Partial<Record<Feature,Record<string,string[]>>>;

export type ExplainCorpus={
 version:string;
 sounds:Record<string,{name:string;short:string;long:string;words?:string[]}>;
 actions:Record<string,string>;
 /** A dotted beat (¾ + ¼) said as one move. */
 dotted:string;
 /** Music words a child's card line does not use (on top of the style rules' list): the card says them as sounds and moves. */
 childAvoid:string[];
 /** Body movements: 动一动 must name one. */
 moves:string[];
 /** Child sentences: row → feature → value → three or more lines ({action} / {long} filled by the program). */
 child:Record<Row,Bank>;
 /** Words that show a sentence is about a point (feature → value → any one of them). */
 keywords:Record<Feature,Record<string,string[]>>;
 /** How a point is named for teachers and in the prompt (feature → value). */
 teacherWords:Record<Feature,Record<string,string>>;
 /** The teacher's line for a row's point ({word}, and {rhythm} / {action} for the bar). */
 teacher:Record<Row,Partial<Record<Feature,string>>>;
 facts:{free:string;even:string;metre:string;tempo:Record<'slow'|'medium'|'quick'|'fast',string>;mode:Record<string,string>;rhythm:string;
  sources:Record<FactSource,string>};
 /** Which feature each row talks about (see ./points.ts). */
 points:{
  rows:Record<'listen'|'move'|'moveFree'|'play'|'playFree',Feature[]>;
  rowBonus:Partial<Record<Row,Partial<Record<Feature,number>>>>;
  tempo:{fastFrom:number;slowBelow:number;centre:number;span:number};
  register:{highFrom:number;lowTo:number;centre:number;span:number};
  salience:Partial<Record<Feature,Record<string,number>>>;
  /** Two lines sharing more than this share of their character pairs count as the same sentence. */
  similarAbove:number;
 };
};

/** The longest title and child line on a card, and a teacher line (characters). */
export const EXPLAIN_LIMITS={title:12,child:30,teacher:40} as const;
const CHILD_PLACES=['action','long'],TEACHER_PLACES=['word','rhythm','action'];

export const cardTerms=(text:string,file:Pick<ExplainCorpus,'childAvoid'>)=>file.childAvoid.filter(word=>text.includes(word)).map(word=>`给孩子的卡片上用了乐理词「${word}」`);
/** A child line with its placeholders filled by typical words, for checking what a child will read. */
const sample=(text:string)=>fill(text,{action:'跑跑 走',long:'啾'});

export function explainProblems(file:ExplainCorpus){
 const problems:string[]=[];
 const line=(where:string,text:unknown,slot:Slot,allowed:readonly string[])=>{
  if(typeof text!=='string'){problems.push(`${where} 应该是一句话`);return;}
  problems.push(...unknownPlaceholders(where,text,allowed),...wordProblems(text,slot).map(problem=>`${where}：${problem}`),
   ...(slot==='teacherLine'?[]:cardTerms(text,file).map(problem=>`${where}：${problem}`)));
 };
 if(!file.sounds?.plain)problems.push('explain.sounds.plain 缺少（模型选不出时用它）');
 for(const [id,set] of Object.entries(file.sounds??{}))if(!set.short||!set.long||!set.name)problems.push(`explain.sounds.${id} 要有 name、short、long`);
 for(const beats of ['0.25','0.5','0.75','1','1.5','2'])if(!file.actions?.[beats])problems.push(`explain.actions.${beats} 缺少`);
 for(const [feature,values] of Object.entries(FEATURE_VALUES) as [Feature,readonly string[]][])for(const value of values){
  if(!file.keywords?.[feature]?.[value]?.length)problems.push(`explain.keywords.${feature}.${value} 缺少`);
  if(!file.teacherWords?.[feature]?.[value])problems.push(`explain.teacherWords.${feature}.${value} 缺少`);
 }
 const rowsOf:Record<Row,Feature[]>={listen:file.points.rows.listen,move:[...new Set([...file.points.rows.move,...file.points.rows.moveFree])],play:[...new Set([...file.points.rows.play,...file.points.rows.playFree])]};
 for(const row of ROWS)for(const feature of rowsOf[row]){
  const bank=file.child?.[row]?.[feature];
  if(!bank){problems.push(`explain.child.${row}.${feature} 缺少（points.rows 里用到了）`);continue;}
  line(`explain.teacher.${row}.${feature}`,file.teacher?.[row]?.[feature],'teacherLine',TEACHER_PLACES);
  for(const value of FEATURE_VALUES[feature]){
   const lines=bank[value];
   if(!Array.isArray(lines)||lines.length<3){problems.push(`explain.child.${row}.${feature}.${value} 至少要 3 句（不同的歌才不会一样）`);continue;}
   lines.forEach((text,i)=>{
    const where=`explain.child.${row}.${feature}.${value}[${i}]`;
    line(where,text,'cardLine',CHILD_PLACES);
    if(!file.keywords[feature]?.[value]?.some(word=>sample(text).includes(word)))problems.push(`${where} 没有用到「${file.teacherWords[feature]?.[value]}」的关键词`);
    if(row==='move'&&!file.moves.some(word=>text.includes(word)))problems.push(`${where} 没有身体动作`);
   });
  }
 }
 return problems;
}
function load(file:ExplainCorpus){
 const problems=explainProblems(file);
 if(problems.length)throw new Error(`语料文件有误：\n${problems.join('\n')}`);
 return file;
}
export const EXPLAIN=load(explainFile as unknown as ExplainCorpus);
