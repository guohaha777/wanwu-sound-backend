import {test} from 'node:test';
import assert from 'node:assert/strict';
import {judge,report} from '../src/index.ts';
import type {Measurement} from '../src/index.ts';

const m={version:'music-features-v2',seconds:60,musical:true,features:{rhythm:'steady',texture:'accompanied',drums:false},path:'accompanied',
 traits:{steady:.8,tonal:.6,solo:.3,drums:.2},steady:true,strongBeat:true,tempoBpm:136,meter:3,meterConfidence:.7,downbeatSeconds:.139,
 onsetsPerBeat:1.4,onsetDensity:'medium',centroidHz:2000,brightness:'mid',mode:'major',tonic:5,keyConfidence:.8,pitchRange:{low:58,high:82},
 repetition:'low',candidates:[{cell:[.75,.25,1,1],bars:10}]} satisfies Measurement;

test('only filled answers are judged; tempo within 4 %, a strong beat a whole bar later still right',()=>{
 assert.deepEqual(judge(m,{}),[]);
 const bar=60/136*3;
 const checks=judge(m,{tempoBpm:133,meter:3,downbeatSeconds:.139+2*bar,tonic:5,mode:'major',rhythmCell:[.75,.25,1,1],drums:false});
 assert.ok(checks.every(check=>check.ok),JSON.stringify(checks));
 assert.equal(checks.length,7);
});

test('typical slips are named: double / half tempo, the relative key, a strong beat one beat off',()=>{
 const by=(answers:Parameters<typeof judge>[1])=>judge(m,answers)[0];
 assert.deepEqual(by({tempoBpm:68}),{field:'tempoBpm',ok:false,note:'double'});
 assert.deepEqual(by({tempoBpm:272}),{field:'tempoBpm',ok:false,note:'half'});
 assert.deepEqual(by({tempoBpm:110}),{field:'tempoBpm',ok:false});
 // Measured F major; the answer D minor is its relative minor.
 assert.deepEqual(judge(m,{tonic:2,mode:'minor'}),[{field:'tonic',ok:false,note:'relative'},{field:'mode',ok:false}]);
 assert.deepEqual(judge(m,{downbeatSeconds:.139+60/136,meter:3}),[{field:'meter',ok:true},{field:'downbeatSeconds',ok:false,note:'offbeat'}]);
 assert.deepEqual(judge(m,{rhythmCell:[1,1,1]},[1,1,1]),[{field:'rhythmCell',ok:true}],'the card\'s own pick is judged');
});

test('the report counts per set and per measuring path',()=>{
 const r=report([
  {set:'system',path:'accompanied',checks:[{field:'meter',ok:true},{field:'tempoBpm',ok:false,note:'double'}]},
  {set:'system',path:'solo',checks:[{field:'meter',ok:false}]},
  {set:'test',path:'free',checks:[]},
 ]);
 assert.deepEqual([r.system.count,r.test.count],[2,1]);
 assert.deepEqual(r.system.all.meter,{right:1,judged:2,notes:{}});
 assert.deepEqual(r.system.all.tempoBpm,{right:0,judged:1,notes:{double:1}});
 assert.deepEqual(r.system.byPath.solo?.meter,{right:0,judged:1,notes:{}});
 assert.deepEqual(r.test.all,{});
});
