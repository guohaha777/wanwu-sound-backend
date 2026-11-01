import test from 'node:test';
import assert from 'node:assert/strict';
import {selectMelody} from '../src/melody.ts';
import {isTextbookMelody} from '@wanwu-v2/contracts/textbook-melody';
const info={tempo:120,meter:4,excerptStart:10,excerptSeconds:12,audioToken:'b'.repeat(64)};
test('local transcription selection preserves a known synthetic line with onset, duration and confidence',()=>{
 const events=[60,62,64,65,67,69,67,65,64,62,60,60].map((pitchMidi,i)=>({startTimeSeconds:i*.5,durationSeconds:.4,pitchMidi,amplitude:.8}));
 const result=selectMelody(events,info);assert.ok(isTextbookMelody(result));assert.equal(result.status,'extracted');
 assert.deepEqual(result.phrases.flatMap(p=>p.notes.map(n=>n.midi)),events.map(n=>n.pitchMidi));
 assert.ok(result.confidence>.7);assert.equal(result.excerptStart,10);
});
test('silence, noise-like events and weak isolated notes stay uncertain',()=>{
 for(const events of [[],[{startTimeSeconds:0,durationSeconds:.03,pitchMidi:60,amplitude:.9}],
  [{startTimeSeconds:0,durationSeconds:1,pitchMidi:NaN,amplitude:.9}],
  [{startTimeSeconds:0,durationSeconds:1,pitchMidi:60,amplitude:.1}]]){
  const result=selectMelody(events,info);assert.ok(isTextbookMelody(result));assert.equal(result.status,'uncertain');assert.equal(result.phrases.length,0);
 }
});
test('quiet accompaniment candidates do not replace a salient continuous melodic line',()=>{
 const events=Array.from({length:12},(_,i)=>({startTimeSeconds:i*.5,durationSeconds:.45,pitchMidi:64+i%4,amplitude:.85}));
 const harmony=Array.from({length:6},(_,i)=>({startTimeSeconds:i,durationSeconds:.9,pitchMidi:55,amplitude:.4}));
 const result=selectMelody([...events,...harmony],info);assert.equal(result.status,'extracted');
 assert.ok(result.phrases.flatMap(p=>p.notes).every(n=>n.midi>=64));
});
