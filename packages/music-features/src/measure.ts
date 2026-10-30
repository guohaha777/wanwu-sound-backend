// Measures a song recording for a textbook feature card. Everything here is counted from the sound, no model involved:
// - tempo from the periodicity of note onsets (spectral flux), with a gentle preference for walking pace;
// - metre from which bar length (2 / 3 / 4 beats) repeats best, and where the strong beat falls;
// - rhythm candidates: each bar's onsets snapped to the beat grid, the patterns that recur (internal: the model or
//   pickRhythm chooses one, nobody else sees them);
// - key and mode from the pitch-class profile (major / minor / pentatonic), brightness from the spectral centroid,
//   density from onsets per beat, a rough melody range, and how much bars repeat.
// Rough by design: recordings carry accompaniment. Numbers the official docs say the audio model cannot judge (tempo,
// key) come from here; the model listens for what is characteristic.
import type {Brightness,Density,Level,Metre,TextbookMode} from '@wanwu-v2/contracts/textbook';
import {magnitudes} from './fft.ts';

export const MEASURE_VERSION='music-features-v1';
const FRAME=2048,HOP=512,TARGET_RATE=22050;

/** A bar pattern found in the recording, in beats (sums to one bar), and how many bars had it. */
export type RhythmCandidate={cell:number[];bars:number};
export type Measurement={
 version:typeof MEASURE_VERSION;seconds:number;
 tempoBpm:number;meter:Metre;meterConfidence:number;
 onsetsPerBeat:number;onsetDensity:Density;
 centroidHz:number;brightness:Brightness;
 mode:TextbookMode;tonic:number;keyConfidence:number;
 pitchRange:{low:number;high:number};repetition:Level;
 candidates:RhythmCandidate[];
};

const percentile=(values:ArrayLike<number>,p:number)=>{
 const sorted=Array.from(values).sort((a,b)=>a-b);
 return sorted.length?sorted[Math.min(sorted.length-1,Math.max(0,Math.round(p/100*(sorted.length-1))))]!:0;
};
const MAJOR=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],MINOR=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
function correlation(a:readonly number[],b:readonly number[]){
 const n=a.length,ma=a.reduce((s,v)=>s+v,0)/n,mb=b.reduce((s,v)=>s+v,0)/n;
 let num=0,da=0,db=0;for(let i=0;i<n;i++){num+=(a[i]!-ma)*(b[i]!-mb);da+=(a[i]!-ma)**2;db+=(b[i]!-mb)**2;}
 return da&&db?num/Math.sqrt(da*db):0;
}

/** Mono samples at any rate (the page decodes with Web Audio; the server with FFmpeg). */
export function measure(input:Float32Array,sampleRate:number):Measurement{
 // Down to about 22 kHz by block averaging: enough for onsets, pitch classes and brightness.
 const factor=Math.max(1,Math.floor(sampleRate/TARGET_RATE)),rate=sampleRate/factor;
 const samples=new Float32Array(Math.floor(input.length/factor));
 let peak=1e-9;
 for(let i=0;i<samples.length;i++){let sum=0;for(let k=0;k<factor;k++)sum+=input[i*factor+k]!;samples[i]=sum/factor;peak=Math.max(peak,Math.abs(samples[i]!));}
 for(let i=0;i<samples.length;i++)samples[i]=samples[i]!/peak;
 const seconds=input.length/sampleRate,fps=rate/HOP,frames=Math.max(0,Math.floor((samples.length-FRAME)/HOP)+1);
 if(frames<fps*8)throw new Error('recording-too-short');

 const window=new Float32Array(FRAME).map((_,i)=>.5-.5*Math.cos(2*Math.PI*i/(FRAME-1)));
 const binHz=rate/FRAME,bins=FRAME/2+1;
 const pitchClass=new Int8Array(bins).fill(-1),melodyLow=Math.ceil(200/binHz),melodyHigh=Math.floor(1100/binHz);
 for(let k=1;k<bins;k++){const f=k*binHz;if(f>80&&f<2000)pitchClass[k]=((Math.round(12*Math.log2(f/440))+69)%12+12)%12;}
 const flux=new Float32Array(frames),energy=new Float32Array(frames),centroid=new Float32Array(frames),f0=new Float32Array(frames);
 const chroma=new Float32Array(frames*12),frame=new Float32Array(FRAME);
 let previous:Float32Array|null=null;
 for(let t=0;t<frames;t++){
  for(let i=0;i<FRAME;i++)frame[i]=samples[t*HOP+i]!*window[i]!;
  const spectrum=magnitudes(frame,FRAME),logs=new Float32Array(bins);
  let sum=0,weighted=0,rise=0,best=0,bestBin=melodyLow;
  for(let k=0;k<bins;k++){
   const m=spectrum[k]!;logs[k]=Math.log1p(10*m);sum+=m;weighted+=m*k*binHz;
   if(previous)rise+=Math.max(0,logs[k]!-previous[k]!);
   const pc=pitchClass[k]!;if(pc>=0)chroma[t*12+pc]=chroma[t*12+pc]!+m;
   if(k>=melodyLow&&k<=melodyHigh&&m>best){best=m;bestBin=k;}
  }
  flux[t]=rise;energy[t]=sum;centroid[t]=sum?weighted/sum:0;f0[t]=bestBin*binHz;previous=logs;
 }

 // Onset envelope, smoothed; its autocorrelation gives the beat.
 const smooth=new Float32Array(frames),kernel=[.25,.5,1,.5,.25];
 for(let t=0;t<frames;t++){let s=0;for(let j=-2;j<=2;j++)s+=(flux[t+j]??0)*kernel[j+2]!;smooth[t]=s/2.5;}
 const mean=smooth.reduce((s,v)=>s+v,0)/frames,env=smooth.map(v=>v-mean);
 const maxLag=Math.min(frames-1,Math.ceil(fps*60/50)*4+4),ac=new Float32Array(maxLag+1);
 for(let lag=0;lag<=maxLag;lag++){let s=0;for(let t=0;t+lag<frames;t++)s+=env[t]!*env[t+lag]!;ac[lag]=s;}
 const zero=ac[0]||1;for(let lag=0;lag<=maxLag;lag++)ac[lag]=ac[lag]!/zero;
 let lag=0,bestScore=-Infinity;
 for(let l=Math.ceil(fps*60/185);l<=Math.floor(fps*60/55)&&l<maxLag;l++){
  const bpm=60*fps/l,score=ac[l]!*Math.exp(-.5*(Math.log2(bpm/100)/.9)**2);
  if(score>bestScore){bestScore=score;lag=l;}
 }
 // Parabolic peak for a fractional beat length.
 const [a,b,c]=[ac[lag-1]??0,ac[lag]!,ac[lag+1]??0],shift=a-2*b+c?(a-c)/(2*(a-2*b+c)):0;
 const beat=lag+Math.max(-.5,Math.min(.5,shift)),tempoBpm=Math.round(60*fps/beat);
 const near=(beats:number)=>{const l=Math.round(beat*beats);let m=-1;for(let i=l-2;i<=l+2;i++)if(i>0&&i<=maxLag)m=Math.max(m,ac[i]!);return m;};
 const scores={2:near(2),3:near(3),4:near(4)};
 const meter:Metre=scores[3]>Math.max(scores[2],scores[4])*1.05?3:scores[4]>scores[2]*1.15?4:2;
 const sortedScores=Object.values(scores).sort((x,y)=>y-x);
 const meterConfidence=Math.max(0,Math.min(1,(sortedScores[0]!-sortedScores[1]!)/Math.max(.05,Math.abs(sortedScores[0]!))*4));

 // Beat phase, then which beat of the bar is strong.
 const at=(position:number)=>env[Math.round(position)]??0;
 let phase=0,phaseScore=-Infinity;
 for(let p=0;p<Math.ceil(beat);p++){let s=0;for(let x=p;x<frames;x+=beat)s+=at(x);if(s>phaseScore){phaseScore=s;phase=p;}}
 let downbeat=0,downScore=-Infinity;
 for(let m=0;m<meter;m++){let s=0;for(let x=phase+m*beat;x<frames;x+=beat*meter)s+=at(x);if(s>downScore){downScore=s;downbeat=m;}}

 // Onsets: local peaks above the upper quartile and a quarter of the strongest onsets (sparse songs would otherwise
 // count the accompaniment's small ripples), at least 0.12 s apart.
 const threshold=Math.max(percentile(smooth,75),.25*percentile(smooth,99.5)),gap=.12*fps,onsets:number[]=[];
 for(let t=1;t<frames-1;t++)if(smooth[t]!>threshold&&smooth[t]!>=smooth[t-1]!&&smooth[t]!>smooth[t+1]!&&(!onsets.length||t-onsets.at(-1)!>=gap))onsets.push(t);
 const onsetsPerBeat=onsets.length/(frames/beat);
 const onsetDensity:Density=onsetsPerBeat<1.1?'sparse':onsetsPerBeat>2?'busy':'medium';

 // Each bar's onsets on the beat grid (half beats, quarter beats when clearly there); bars that start with a note.
 const barsSeen=new Map<number,Set<number>>(),origin=phase+downbeat*beat;
 for(const t of onsets){
  const position=(t-origin)/beat;if(position<-.25)continue;
  let q=Math.round(position*2)/2;if(Math.abs(position-q)>.15)q=Math.round(position*4)/4;
  let bar=Math.floor(q/meter+1e-9),inBar=q-bar*meter;if(inBar>=meter-1e-9){bar++;inBar=0;}
  if(!barsSeen.has(bar))barsSeen.set(bar,new Set());barsSeen.get(bar)!.add(inBar);
 }
 const counts=new Map<string,RhythmCandidate>();
 for(const positions of barsSeen.values()){
  const sorted=[...positions].sort((x,y)=>x-y);if(sorted[0]!==0||sorted.length>16)continue;
  const cell=sorted.map((p,i)=>(sorted[i+1]??meter)-p);
  if(cell.some(d=>d<.25||d>4))continue;
  const key=cell.join(','),known=counts.get(key);
  if(known)known.bars++;else counts.set(key,{cell,bars:1});
 }
 const ranked=[...counts.values()].sort((x,y)=>y.bars-x.bars);
 const candidates=ranked.filter(item=>item.bars>=2).slice(0,5);
 if(!candidates.length&&ranked[0])candidates.push(ranked[0]);

 // Brightness and key from the louder frames.
 const loudish=percentile(energy,30),loud=percentile(energy,60);
 const centroids:number[]=[],profile=new Array<number>(12).fill(0),pitches:number[]=[];
 for(let t=0;t<frames;t++){
  if(energy[t]!>loudish){centroids.push(centroid[t]!);for(let k=0;k<12;k++)profile[k]=profile[k]!+chroma[t*12+k]!;}
  if(energy[t]!>loud)pitches.push(69+12*Math.log2(f0[t]!/440));
 }
 const centroidHz=Math.round(percentile(centroids,50));
 const brightness:Brightness=centroidHz<1500?'dark':centroidHz>2500?'bright':'mid';
 const total=profile.reduce((s,v)=>s+v,0)||1,norm=profile.map(v=>v/total);
 let tonic=0,major=true,keyConfidence=-1;
 for(let shift=0;shift<12;shift++)for(const [template,isMajor] of [[MAJOR,true],[MINOR,false]] as const){
  const rotated=template.map((_,i)=>template[(i-shift+12)%12]!),r=correlation(norm,rotated);
  if(r>keyConfidence){keyConfidence=r;tonic=shift;major=isMajor;}
 }
 const mode:TextbookMode=!major?'minor':norm[(tonic+5)%12]!+norm[(tonic+11)%12]!<.09?'pentatonic':'major';
 const low=Math.max(21,Math.round(percentile(pitches,5))),high=Math.min(108,Math.max(low+1,Math.round(percentile(pitches,95))));

 // Repetition: how alike bars four bars apart sound (pitch classes).
 const barFrames=Math.max(1,Math.round(beat*meter)),barVectors:number[][]=[];
 for(let start=Math.round(origin);start+barFrames<=frames;start+=barFrames){
  const v=new Array<number>(12).fill(0);for(let t=start;t<start+barFrames;t++)for(let k=0;k<12;k++)v[k]=v[k]!+chroma[t*12+k]!;
  const length=Math.hypot(...v)||1;barVectors.push(v.map(x=>x/length));
 }
 const similarities:number[]=[];
 for(let i=0;i+4<barVectors.length;i++)similarities.push(barVectors[i]!.reduce((s,x,k)=>s+x*barVectors[i+4]![k]!,0));
 const alike=similarities.length?similarities.reduce((s,v)=>s+v,0)/similarities.length:0;
 const repetition:Level=alike>.92?'high':alike<.8?'low':'medium';

 return {version:MEASURE_VERSION,seconds:Math.round(seconds*10)/10,tempoBpm,meter,meterConfidence:Math.round(meterConfidence*100)/100,
  onsetsPerBeat:Math.round(onsetsPerBeat*100)/100,onsetDensity,centroidHz,brightness,mode,tonic,keyConfidence:Math.round(keyConfidence*100)/100,
  pitchRange:{low,high},repetition,candidates};
}
