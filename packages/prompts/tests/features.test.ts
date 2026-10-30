import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acceptTextbookFeatures,buildTextbookFeatures,isTextbookFeaturesBrief,readTextbookFeatures} from '../src/tasks/index.ts';
import type {TextbookFeaturesBrief} from '../src/tasks/index.ts';

const brief:TextbookFeaturesBrief={title:'小鸟在唱歌',listenSeconds:30,tempoBpm:96,meter:2,meterConfidence:.29,mode:'major',onsetDensity:'medium',brightness:'mid',
 candidates:[{cell:[.5,.5,.5,.5],bars:51},{cell:[.5,.5,1],bars:4}],fallbackCell:[.5,.5,.25,.75],others:[{title:'法国号',rhythmCell:[.75,.25,1],childLine:'像号角响亮地吹'}]};

test('the prompt names the song, the numbers, the candidates and the other songs; without audio it says so',()=>{
 assert.ok(isTextbookFeaturesBrief(brief));
 const built=buildTextbookFeatures(brief);
 assert.equal(built.model,'audio');assert.ok(built.system,'the shared system prompt goes along');
 for(const part of ['「小鸟在唱歌」','96','二拍子','[0.5, 0.5, 1] ×4','「法国号」','30 秒','JSON'])assert.ok(built.prompt.includes(part),part);
 const numbersOnly=buildTextbookFeatures({...brief,listenSeconds:0,others:[]});
 assert.ok(numbersOnly.prompt.includes('没有附音频'));assert.ok(numbersOnly.prompt.includes('还没有'));
 assert.equal(isTextbookFeaturesBrief({...brief,meter:5}),false);assert.equal(isTextbookFeaturesBrief({...brief,title:''}),false);
});

test('a good reply is accepted; tempo may be halved; a wrong bar falls back to the program choice; bad sentences drop out',()=>{
 const good={rhythmCell:[.5,.5,1],meter:2,tempo:'same',mood:'lively',childLine:'像小鸟蹦蹦跳跳。',teacherNote:'先两下快的再一下长的，带孩子拍手念“小鸟—叫”。'};
 const ok=acceptTextbookFeatures(good,brief);
 assert.equal(ok.status,'accepted');assert.deepEqual(ok.value?.rhythmCell,[.5,.5,1]);assert.equal(ok.value?.childLine,'像小鸟蹦蹦跳跳');
 assert.equal(acceptTextbookFeatures({...good,tempo:'half'},brief).value?.tempoBpm,48);
 const wrongBar=acceptTextbookFeatures({...good,rhythmCell:[1,1,1]},brief);
 assert.equal(wrongBar.status,'partly');assert.deepEqual(wrongBar.value?.rhythmCell,[.5,.5,.25,.75]);
 const threeFour=acceptTextbookFeatures({...good,meter:3,rhythmCell:[2,1]},brief);
 assert.equal(threeFour.value?.meter,3);assert.deepEqual(threeFour.value?.rhythmCell,[2,1]);
 const preachy=acceptTextbookFeatures({...good,childLine:'这首歌的节奏真棒，小朋友应该认真听'},brief);
 assert.equal(preachy.value?.childLine,null);assert.equal(preachy.status,'partly');
 assert.equal(acceptTextbookFeatures({...good,mood:'sleepy'},brief).status,'rejected');
 assert.equal(readTextbookFeatures('```json\n'+JSON.stringify(good)+'\n```',brief).acceptance.status,'accepted');
 assert.equal(readTextbookFeatures('不知道',brief).acceptance.status,'rejected');
});
