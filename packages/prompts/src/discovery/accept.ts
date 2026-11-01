// Validate complete entries independently. One rejected entry never discards its valid neighbours.
// Formatting repairs cannot supply facts, audio observations or actions that were not provided.
import type {DiscoveryBrief,DiscoverySet,Evidence,PointText} from '@wanwu-v2/contracts/discovery';
import {DISCOVERY_RULES} from '@wanwu-v2/sound-rules/discovery';
import {lineProblems} from '../accept.ts';
import {DISCOVERY_CORPUS,POINT_SLOTS,TEACHER_SLOTS} from './corpus.ts';
import type {DiscoveryCorpus} from './corpus.ts';
import {angleOf} from './local.ts';
import type {Slot} from '../style.ts';

export type SetAcceptance={status:'accepted'|'rejected';set:DiscoverySet|null;notes:string[]};

const BRACKETED_IDS=/\s*[（(]\s*(?:证据|依据|见|参考)?\s*E\d+(?:\s*[、,，/和及与]\s*E\d+)*\s*[）)]/g;
const INLINE_IDS=/\s*E\d+(?:\s*[、,，/和及与]\s*E\d+)*\s*(?:的)?/g;
const textOf=(value:unknown)=>typeof value==='string'?value.replace(BRACKETED_IDS,'').trim():'';
const teacherTextOf=(value:unknown)=>textOf(value).replace(INLINE_IDS,'').trim();

/** Numbers a piece of evidence states, as written and rounded; times in the piece only for the teacher. */
function numbersOf(items:readonly Evidence[],teacher:boolean,spans:readonly [number,number][]=[]){
 const numbers=new Set<number>();
 const add=(value:number)=>{
  numbers.add(value);
  numbers.add(Math.round(value));
  numbers.add(Math.floor(value));
 };
 for(const item of items){
  for(const value of Object.values(item.values))if(typeof value==='number')add(Math.abs(value));
  if(teacher&&item.range)item.range.forEach(add);
 }
 if(teacher)for(const span of spans)span.forEach(add);
 return [...numbers];
}

/** Reads the reply into a set (the prompt asks for exactly these fields), tidied; or says why it cannot. */
function readSet(reply:unknown):DiscoverySet|string{
 if(!reply||typeof reply!=='object')return '回复不是一个对象';
 const raw=reply as Record<string,unknown>;
 const summary=raw.summary as Record<string,unknown>|null;
 if(!Array.isArray(raw.points)||!raw.points.length)return '回复里没有 points';
 
 const points:PointText[]=[];
 for(const item of raw.points){
  const point=item as Record<string,unknown>|null;
  const teacher=point?.teacher as Record<string,unknown>|null;
  if(!point||typeof point!=='object')continue;
  points.push({
   point:textOf(point.point),
   action:textOf(point.action)||undefined,
   where:textOf(point.where)||undefined,
   evidence:Array.isArray(point.evidence)?point.evidence.filter((id):id is string=>typeof id==='string'):[],
   knowledge:textOf(point.knowledge),
   discovery:textOf(point.discovery),
   ask:textOf(point.ask),
   try:textOf(point.try),
   teacher:{concept:teacherTextOf(teacher?.concept),how:teacherTextOf(teacher?.how),listen:teacherTextOf(teacher?.listen)},
  });
 }
 return {points,summary:{child:textOf(summary?.child),teacher:teacherTextOf(summary?.teacher)}};
}

export function acceptDiscoverySet(reply:unknown,brief:DiscoveryBrief,corpus:DiscoveryCorpus=DISCOVERY_CORPUS):SetAcceptance{
 const read=readSet(reply);
 if(typeof read==='string')return {status:'rejected',set:null,notes:[read]};
 const notes:string[]=[];
 const tokens=brief.sounds.map(sound=>sound.token);
 const spans=brief.sounds.flatMap(sound=>sound.spans);
 const backgroundEvidence=brief.evidence.find(item=>item.kind==='background');
 const least=1;
 const most=DISCOVERY_RULES.maxPoints;
 const accepted:PointText[]=[];
 if(read.points.length<least||read.points.length>most)notes.push(`要写 ${least}–${most} 点，写了 ${read.points.length} 点`);
 const told=new Set<string>();
 const angles=new Set<string>();

 const check=(where:string,text:string,slot:Slot,child:boolean,evidence:readonly Evidence[])=>{
  const numbers=numbersOf(evidence,!child,spans);
  for(const problem of lineProblems(text,slot,tokens,numbers))notes.push(`${where} ${problem}`);
  if(child&&/E\d+/.test(text))notes.push(`${where} 文字里写了证据编号`);
  if(/[A-Za-z]{3,}/.test(text))notes.push(`${where} 夹了英文`);
  if(!child)for(const word of corpus.teacherAvoid)if(text.includes(word))notes.push(`${where} 老师提示过于专业「${word}」`);
  if(child)for(const word of corpus.childAvoid)if(text.includes(word))notes.push(`${where} 给孩子的话里用了「${word}」`);
  for(const word of (brief.observations?.length?[]:corpus.hearingClaims))if(text.includes(word))notes.push(`${where} 说自己听过作品「${word}」`);
  if(!backgroundEvidence)for(const name of brief.background.instruments)
   if(text.includes(name))notes.push(`${where} 提到了乐器「${name}」，但背景没有开`);
 };
 read.points.forEach((point,i)=>{
  const where=`第 ${i+1} 点`;
  const before=notes.length;
  const candidate=point.action
   ?{id:point.point,evidence:point.evidence,action:point.action}
   :brief.points.find(item=>item.id===point.point);
  if(!candidate){
   notes.push(`${where} 不是候选里的特征`);
   return;
  }
  if(told.has(candidate.id))notes.push(`${where} 和前面讲的是同一个候选`);

  // The candidate's own evidence always counts; the model may add any other it related.
  const ids=[...new Set([...candidate.evidence,...point.evidence])];
  const evidence=ids.map(id=>brief.evidence.find(item=>item.id===id)??observationEvidence(brief,id));
  if(!ids.length)notes.push(`${where} 没有证据`);
  if(evidence.some(item=>!item))notes.push(`${where} 引用了不存在的证据`);
  const known=evidence.filter((item):item is Evidence=>!!item);
  const main=known[0];
  if(!main)return;
  const angle=main.id.startsWith('O')?main.id:angleOf(main);
  if(angles.has(angle))notes.push(`${where} 和前面讲的是同一件事`);

  point.evidence=ids;
  for(const [field,slot] of Object.entries(POINT_SLOTS))
   check(`${where} ${field}`,point[field as keyof typeof POINT_SLOTS]??'',slot,true,known);
  for(const [field,slot] of Object.entries(TEACHER_SLOTS))
   check(`${where} teacher.${field}`,point.teacher[field as keyof typeof TEACHER_SLOTS],slot,false,known);
  if(brief.evidence.some(item=>item.kind==='gap-filled')&&/寂静|静默|突然安静|没有任何声音/.test(point.discovery+point.teacher.concept+point.teacher.how))
   notes.push(`${where} 把孩子声音的空档当成整曲静默`);
  // Reject clear provenance errors and unperformed experiments presented as current facts.
  if(/(?:孩子|儿童)(?:发出|发声|模仿|唱出)/.test(point.discovery))
   notes.push(`${where} 把选用素材当成孩子发声`);
  if(/^(?:关掉|关闭|调低|换掉|移开|拿走).*(?:后|之后)/.test(point.discovery))
   notes.push(`${where} 把未执行的实验结果当成当前发现`);
  const action=brief.actions.find(item=>item.id===candidate.action);
  if(!action)notes.push(`${where} 操作不存在`);
  if(point.action&&!point.where)notes.push(`${where} 没有听哪里`);
  if(point.where)check(`${where} where`,point.where,'cardFind',true,known);
  if(action?.target&&!point.try.includes(action.target))notes.push(`${where} try 没有说要改的「${action.target}」`);
  if(notes.length===before&&accepted.length<most){
   accepted.push(point);
   told.add(candidate.id);
   angles.add(angle);
  }
 });
 return accepted.length
  ?{status:'accepted',set:{points:accepted,summary:{child:'',teacher:''}},notes}
  :{status:'rejected',set:null,notes:notes.length?notes:['没有完整合格条目']};
}

function observationEvidence(brief:DiscoveryBrief,id:string):Evidence|undefined{
 const observation=brief.observations?.find(item=>item.id===id);
 return observation?{id,kind:'background',source:'listening',sounds:[],range:observation.range,
  values:{observation:observation.observation}}:undefined;
}
