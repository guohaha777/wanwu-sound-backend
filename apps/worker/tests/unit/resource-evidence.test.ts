import test from 'node:test';
import assert from 'node:assert/strict';
import {assessMemory} from '../../src/resource-evidence.ts';

const limit=1024**3,healthy={max:0,oom:0,oom_kill:0};
test('measured memory below the enforced limit has no capacity warning',()=>{
 assert.deepEqual(assessMemory(limit,700*1024**2,healthy),{memoryPressure:false,peakAboveLimit:false});
});
test('kernel reclaim and temporary peak overshoot remain visible rather than pretending the limit was raised',()=>{
 assert.deepEqual(assessMemory(limit,limit+4096,{...healthy,max:12}),{memoryPressure:true,peakAboveLimit:true});
 assert.equal(assessMemory(limit,Math.round(limit*.95),healthy).memoryPressure,true);
});
test('any allocation failure or OOM kill blocks the gate even when the media task succeeded',()=>{
 assert.throws(()=>assessMemory(limit,limit,{...healthy,oom:1}),/allocation failure/);
 assert.throws(()=>assessMemory(limit,limit,{...healthy,oom_kill:1}),/OOM kill/);
});
test('missing or invalid kernel evidence cannot report a pass',()=>{
 for(const peak of [0,NaN,-1,Infinity,1.5])assert.throws(()=>assessMemory(limit,peak,healthy));
 const invalid:Record<string,number>[]=[{},{max:0,oom:0},{...healthy,max:-1},{...healthy,oom_kill:NaN}];
 for(const events of invalid)assert.throws(()=>assessMemory(limit,700,events));
 assert.throws(()=>assessMemory(0,700,healthy));
});
