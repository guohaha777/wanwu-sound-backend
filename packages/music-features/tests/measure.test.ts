import {test} from 'node:test';
import assert from 'node:assert/strict';
import {measure,modelExcerpt,pickRhythm} from '../src/index.ts';

const RATE=22050;
const C_MAJOR=[60,64,67],A_MINOR=[57,60,64];
/**
 * A synthetic song: a plucked note (decaying harmonics) on every onset of `cell`, louder on the strong beat, over a soft
 * held chord. Known tempo, metre, rhythm and key.
 */
function song({bpm,meter,cell,chord,seconds=40}:{bpm:number;meter:number;cell:number[];chord:number[];seconds?:number}){
 const out=new Float32Array(RATE*seconds),beat=60/bpm;
 const hz=(midi:number)=>440*2**((midi-69)/12);
 for(let i=0;i<out.length;i++){const t=i/RATE;out[i]=.04*chord.reduce((s,m)=>s+Math.sin(2*Math.PI*hz(m)*t),0);}
 let at=0,note=0;
 while(at<seconds-1){
  for(const length of cell){
   const start=Math.round(at*RATE),strong=Math.abs(at/(beat*meter)-Math.round(at/(beat*meter)))<1e-6;
   const pitch=hz(chord[note++%chord.length]!+12);
   // Decays, then fades out smoothly over the last 0.1 s (a hard cut would click like a new note).
   for(let i=0;i<RATE*.4&&start+i<out.length;i++){
    const t=i/RATE,fade=t>.3?.5+.5*Math.cos(Math.PI*(t-.3)/.1):1,decay=Math.exp(-t*9)*fade*(strong?1:.6);
    out[start+i]=out[start+i]!+decay*(Math.sin(2*Math.PI*pitch*t)+.5*Math.sin(4*Math.PI*pitch*t)+.25*Math.sin(6*Math.PI*pitch*t));
   }
   at+=length*beat;
  }
 }
 return out;
}

test('a 2/4 song at 96 BPM with 嘀嘀嗒: tempo, metre, rhythm and key are found',()=>{
 const m=measure(song({bpm:96,meter:2,cell:[.5,.5,1],chord:C_MAJOR}),RATE);
 assert.ok(Math.abs(m.tempoBpm-96)<=3,`tempo ${m.tempoBpm}`);
 assert.equal(m.meter,2);
 assert.ok(m.candidates.some(c=>c.cell.join()==='0.5,0.5,1'),JSON.stringify(m.candidates));
 assert.deepEqual(pickRhythm(m.candidates,m.meter),[.5,.5,1]);
 assert.equal(m.tonic,0);assert.notEqual(m.mode,'minor');
});

test('a 3/4 song at 72 BPM with 嗒— 嗒 in A minor',()=>{
 const m=measure(song({bpm:72,meter:3,cell:[2,1],chord:A_MINOR}),RATE);
 assert.ok(Math.abs(m.tempoBpm-72)<=3,`tempo ${m.tempoBpm}`);
 assert.equal(m.meter,3);
 assert.deepEqual(pickRhythm(m.candidates,m.meter),[2,1],JSON.stringify(m.candidates));
 assert.equal(m.mode,'minor');assert.equal(m.tonic,9);
});

test('higher sample rates give the same answer; too short a recording is refused',()=>{
 const base=song({bpm:96,meter:2,cell:[.5,.5,1],chord:C_MAJOR,seconds:30});
 const doubled=new Float32Array(base.length*2);for(let i=0;i<doubled.length;i++)doubled[i]=base[i>>1]!;
 assert.equal(measure(doubled,RATE*2).meter,measure(base,RATE).meter);
 assert.throws(()=>measure(new Float32Array(RATE*3),RATE),/too-short/);
});

test('the program prefers a varied recurring rhythm over an even pulse, and picks a 30 s excerpt',()=>{
 assert.deepEqual(pickRhythm([{cell:[.5,.5,.5,.5],bars:9},{cell:[.5,.5,1],bars:6}],2),[.5,.5,1]);
 assert.deepEqual(pickRhythm([{cell:[1,1],bars:9}],2),[1,1]);
 assert.deepEqual(pickRhythm([],3),[1,1,1]);
 assert.deepEqual(modelExcerpt(120),{start:10,end:40});
 assert.deepEqual(modelExcerpt(20),{start:0,end:20});
});
