import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPLAIN,acceptExplain,actionWords,explainCard,explainPoints,explainProblems,isExplainReply,rhythmNotes,similarity,soundForTitle} from '../src/explain/index.ts';
import type {PointFeatures} from '../src/explain/index.ts';
import {TEXTBOOK_FEATURES_PROMPT,acceptTextbookFeatures,buildTextbookFeatures} from '../src/tasks/features.ts';

const bird={id:'tb:bird',title:'小鸟在唱歌',tempoBpm:96,meter:2 as const,rhythmCell:[.5,.5,.5,.25,.25],mood:'lively' as const,tonic:0,mode:'major' as const,
 childLine:'小鸟拍拍翅膀飞起来',onsetDensity:'medium' as const,pitchRange:{low:59,high:84},brightness:'mid' as const,repetition:'medium' as const};
const horn={...bird,id:'tb:horn',title:'法国号',tempoBpm:136,meter:3 as const,rhythmCell:[.75,.25,1,1],tonic:5,childLine:'像号角吹出长长的音',repetition:'low' as const};
const source={numbers:'measured',rhythm:'measured'} as const;

test('the explain corpus loads; a bad edit is named (length, words, no movement, off its point, too few lines)',()=>{
 assert.deepEqual(explainProblems(EXPLAIN),[]);
 const bad=structuredClone(EXPLAIN);
 bad.child.move.metre!['3']=['这个节奏型真棒','一二三，一二三，像小船摇呀摇。','很安静地听着。'];
 bad.child.listen.tempo!.fast=['音乐慢慢的。'];
 const problems=explainProblems(bad).join('\n');
 assert.match(problems,/move\.metre\.3\[0\].*真棒/);
 assert.match(problems,/move\.metre\.3\[2\] 没有身体动作/);
 assert.match(problems,/listen\.tempo\.fast 至少要 3 句/);
});

test('the program says the bar: action words by beat, one syllable per note, the strong beat first',()=>{
 assert.equal(actionWords([.5,.5,1]),'跑跑 走');
 assert.equal(actionWords([.75,.25,1,1]),'跳-跳 走 走');
 assert.equal(actionWords([1,2]),'走 走——');
 assert.deepEqual(rhythmNotes([.5,.5,1],'bird',true).map(n=>[n.syllable,n.strong]),[['叽',true],['叽',false],['啾',false]]);
 assert.deepEqual(rhythmNotes([.5,.5,1],'nope',false).map(n=>n.syllable),['哒','哒','哒'],'an unknown set is the plain one');
 assert.equal(soundForTitle('小鸟在唱歌'),'bird');
 assert.equal(soundForTitle('法国号'),'horn');
 assert.equal(soundForTitle('摇篮曲'),'plain');
});

test('each row talks about a different, distinctive feature of the song; two songs get different points',()=>{
 const b=explainPoints(bird),h=explainPoints(horn);
 for(const p of [b,h])assert.equal(new Set([p.listen.feature,p.move.feature,p.play.feature]).size,3,JSON.stringify(p));
 assert.deepEqual([h.listen.feature,h.listen.value,h.move.feature,h.move.value],['tempo','fast','metre','3'],'136 BPM is fast; 3/4 leads the movement');
 assert.equal(b.move.feature,'rhythm','a bar of running notes leads the movement');
 const free=explainPoints({...bird,pulse:'none'} as PointFeatures);
 assert.equal(free.move.feature,'metre');
 assert.equal(free.move.value,'free');
 assert.deepEqual(explainPoints(bird),b,'the same song always gets the same points');
});

test('offline the card follows the music: different songs, different lines; the same song, the same lines',()=>{
 const b=explainCard(bird,null,source),h=explainCard(horn,null,source);
 assert.equal(b.fromModel,0);
 for(const row of ['listen','move','play'] as const)assert.notEqual(b.child[row],h.child[row],row);
 assert.deepEqual(explainCard(bird,null,source).child,b.child);
 assert.ok(b.child.move.includes('跑跑 跑快快'),'a row about the bar says the action words');
 assert.equal(b.rhythm?.said,'叽叽 叽叽叽');
 assert.deepEqual(b.teacher.facts.map(f=>f.label),['2/4 拍','稍快 96','C 大调','节奏 跑跑 跑快快']);
 const free=explainCard({...bird,pulse:'none'},null,source);
 assert.equal(free.rhythm,null);
 assert.equal(free.teacher.facts.length,2,'no tempo, no bar');
});

test('the model\'s rows must be about their points, unlike each other and other songs; a failed row falls back',()=>{
 const points=explainPoints(horn),check={points,rhythmCell:horn.rhythmCell,numbers:[.75,.25,1,3,136],own:true,others:['像号角一样吹出长长的声音。']};
 const good={title:'号角响起来',sound:'horn',listen:'号声跑得飞快，像在赶路。',move:'一二三，像荡秋千一样摇。',play:'中间那一下最长，放你的声音。',highlight:['飞快','不在句子里'],
  teacher:{listen:'先听速度：很快。',move:'三拍子，第一拍跺脚。',play:'声音摆在中间的长音上。'}};
 const ok=acceptExplain(good,check);
 assert.equal(ok.value.listen,good.listen);
 assert.equal(ok.value.move,good.move);
 assert.deepEqual(ok.value.highlight,['飞快']);
 assert.ok(isExplainReply(ok.value));
 const off=acceptExplain({...good,listen:'声音亮亮的，像早上的太阳。',move:'一二三，大家一起唱。',play:'像号角一样吹出长长的声音呀。'},check);
 assert.equal(off.value.listen,null,'not about 速度偏快');
 assert.equal(off.value.move,null,'no movement');
 assert.equal(off.value.play,null,'too like another song');
 assert.match(off.notes.join('\n'),/没有讲到要点「速度偏快」/);
 assert.equal(acceptExplain(good,{...check,own:false}).value.play,null,'the long note is the bar\'s: it no longer fits');
 const same=acceptExplain({...good,move:'号声一二三，像荡秋千一样摇。'},check);
 assert.equal(same.value.move,null,'opens like 听一听');
 const card=explainCard(horn,ok.value,source);
 assert.equal(card.title,'号角响起来');
 assert.equal(card.fromModel,8);
 assert.equal(card.rhythm?.notes[0]?.syllable,'嘟');
 assert.ok(similarity('音乐跑得飞快','音乐跑得飞快！')>.9);
 assert.equal(similarity('',''),0);
});

test('the prompt names each row\'s point and its words, sends the card\'s principles, and its own example passes',()=>{
 const built=buildTextbookFeatures({title:'法国号',listenSeconds:30,tempoBpm:136,meter:3,meterConfidence:.7,mode:'major',onsetDensity:'medium',brightness:'mid',
  candidates:[{cell:[.75,.25,1,1],bars:10}],fallbackCell:[.75,.25,1,1],others:[],pitchRange:{low:58,high:82},repetition:'low'});
 for(const part of ['要点是「速度偏快」','要点是「三拍子，强弱弱」','要点是「小节中间的长音」','句式示范'])assert.ok(built.prompt.includes(part),part);
 assert.ok(built.system?.includes('唱游·音乐'));
 const result=acceptTextbookFeatures(TEXTBOOK_FEATURES_PROMPT.example,{tempoBpm:96,meter:2,meterConfidence:.1,listenSeconds:30,fallbackCell:[1,1],candidates:[],
  onsetDensity:'medium',brightness:'mid',mode:'major',pitchRange:{low:60,high:76},repetition:'medium'});
 assert.equal(result.status,'accepted',result.notes.join('；'));
 assert.deepEqual(result.notes,[]);
});
