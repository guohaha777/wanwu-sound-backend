// Portraits use the song's clock, including long sounds across every bar they occupy.
import type {TextbookComposeInput,TextbookSound} from '@wanwu-v2/contracts/textbook-compose';
import type {Density} from '@wanwu-v2/contracts/textbook';
import {mergeSpans} from './mix.ts';
import file from '../rules/textbook-compose.v1.json' with {type:'json'};
export type TextbookRules=typeof file;
export const TEXTBOOK_RULES=file;
export type TextbookBar={start:number;end:number;onsets:number;coverage:number;overlap:number;maxConcurrent:number;density:Density;};
export type TextbookSection=TextbookBar&{startBar:number;endBar:number;};
export const knownFeature=(s:TextbookSound,k:keyof NonNullable<TextbookSound['sources']>)=>
 !!s.sources?.[k]&&!['unknown','default'].includes(s.sources[k]!);
export function textbookPortrait(input:TextbookComposeInput,rules:TextbookRules=TEXTBOOK_RULES){
 const beat=60/input.textbook.tempoBpm,bar=beat*input.textbook.meter;
 const measure=(start:number,end:number):TextbookBar=>{
  const spans=input.sounds.filter(s=>s.start<end&&s.end>start)
   .map(s=>({start:Math.max(start,s.start),end:Math.min(end,s.end)}));
  const coverage=mergeSpans(spans,end).reduce((sum,s)=>sum+s.end-s.start,0)/(end-start);
  const points=spans.flatMap(s=>[{at:s.start,delta:1},{at:s.end,delta:-1}]).sort((a,b)=>a.at-b.at||a.delta-b.delta);
  let active=0,previous=start,overlap=0,maxConcurrent=0;
  for(const p of points){if(active>1)overlap+=p.at-previous;active+=p.delta;maxConcurrent=Math.max(maxConcurrent,active);previous=p.at;}
  overlap/=end-start;
  const onsets=input.sounds.filter(s=>s.start>=start&&s.start<end).length,d=rules.density;
  const density:Density=coverage>=d.busyCoverage||onsets>=d.busyOnsets||overlap>=d.busyOverlap?'busy'
   :coverage<d.sparseCoverage&&onsets<=d.sparseMaxOnsets&&overlap===0?'sparse':'medium';
  return {start,end,onsets,coverage,overlap,maxConcurrent,density};
 };
 const bars=Array.from({length:Math.ceil(input.seconds/bar)},(_,i)=>measure(i*bar,Math.min(input.seconds,(i+1)*bar)));
 const sections:TextbookSection[]=[];
 for(let i=0;i<bars.length;i+=rules.sectionBars){
  const endBar=Math.min(i+rules.sectionBars,bars.length),inside=bars.slice(i,endBar);
  const density=inside.some(b=>b.density==='busy')?'busy':inside.every(b=>b.density==='sparse')?'sparse':'medium';
  sections.push({...measure(bars[i]!.start,inside.at(-1)!.end),density,startBar:i,endBar});
 }
 return {beat,bar,bars,sections};
}
