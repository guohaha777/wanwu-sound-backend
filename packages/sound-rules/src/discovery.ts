// 音乐小发现的门槛 (rules/discovery.v1.json): when a rest counts, how much longer is "long", how much louder the
// background must be before a point may say it covers a sound, how much softer or louder the end must get, how many
// points to tell and which kinds are worth telling first (0: context only, never a point — the chosen mood). Numbers
// only; the words are corpus (@wanwu-v2/prompts) and the facts are found by the page.
import type {EvidenceKind} from '@wanwu-v2/contracts/discovery';
import {EVIDENCE_KINDS} from '@wanwu-v2/contracts/discovery';
import discoveryFile from '../rules/discovery.v1.json' with {type:'json'};

export type DiscoveryRules=Omit<typeof discoveryFile,'weights'>&{weights:Record<EvidenceKind,number>};

/** Everything wrong with the file, in plain words; [] when it may be used. */
export function discoveryProblems(file:DiscoveryRules){
 const problems:string[]=[];
 const between=(name:string,value:unknown,min:number,max:number)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)
   problems.push(`discovery.${name} 应该在 ${min}–${max} 之间`);
 };
 if(typeof file.version!=='string'||!file.version)problems.push('discovery.version 应该是版本名');
 between('restSeconds',file.restSeconds,.5,10);
 between('longShortRatio',file.longShortRatio,1.2,10);
 between('densityDifference',file.densityDifference,1,10);
 between('maskedMarginDb',file.maskedMarginDb,-12,12);
 between('audibleDb',file.audibleDb,-80,-10);
 between('dynamicsDb',file.dynamicsDb,1,30);
 between('candidates',file.candidates,1,4);
 between('maxPoints',file.maxPoints,1,3);
 if(file.maxPoints>file.candidates)problems.push('discovery.maxPoints 不能多于 candidates');
 between('requestDelaySeconds',file.requestDelaySeconds,0,10);
 for(const kind of EVIDENCE_KINDS)between(`weights.${kind}`,file.weights?.[kind],0,10);
 for(const key of Object.keys(file.weights??{}))
  if(!EVIDENCE_KINDS.includes(key as EvidenceKind))problems.push(`discovery.weights.${key} 不认识（拼错了？）`);
 return problems;
}

const problems=discoveryProblems(discoveryFile as DiscoveryRules);
if(problems.length)throw new Error(`规则文件有误：\n${problems.join('\n')}`);
export const DISCOVERY_RULES=discoveryFile as DiscoveryRules;
