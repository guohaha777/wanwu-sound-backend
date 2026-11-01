// Model replies as they might come back — good, wrapped, overlong, inventing facts — and what the page gets from each.
import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptMood,acceptSoundHint,acceptTextbookWords,restoreNames} from '../src/accept.ts';
import {buildBackgroundCompose,readBackgroundCompose,readMoodWords,readReply,readTextbookTalk,readTextbookWords,readWorkTalk} from '../src/tasks/index.ts';
import {calmLullaby,textbookBrief,tokenized,workBrief} from './fixtures/briefs.ts';

const good={lines:[
 {kind:'opening',line:'先是「声音1」，「声音2」马上跟着来。'},
 {kind:'repeat',line:'「声音1」响了 3 次，像小朋友在拍手。'},
 {kind:'together',line:'「声音2」和「声音3」一起响，像两个人合唱。'},
 {kind:'long-short',line:'「声音2」响 6.2 秒，「声音3」只响 0.5 秒。'},
 {kind:'rest',line:'中间安静了 3 秒，大家都在等。'},
 {kind:'ending',line:'最后又是「声音1」，像绕了一圈回到家。'},
],tryThis:'把「声音3」往后挪一点，听听会不会分开。'};

test('reading: Markdown, a sentence before the JSON and a trailing comma are repaired and noted',()=>{
 assert.deepEqual(readReply('{"a":1}'),{value:{a:1},repairs:[]});
 const wrapped=readReply('好的，结果如下：\n```json\n{"a":1,}\n```');
 assert.deepEqual(wrapped.value,{a:1});
 assert.deepEqual(wrapped.repairs,['去掉了 JSON 前后的文字','去掉了多余的逗号']);
 assert.deepEqual(readReply('```json\n{"a":[1,2,]}\n```').repairs,['去掉了 Markdown 包裹','去掉了多余的逗号']);
 assert.equal(readReply('我不知道').value,null);
});

test('work talk: a good reply is shown as is, with the child names put back',()=>{
 const {acceptance}=readWorkTalk(JSON.stringify(good),workBrief);
 assert.equal(acceptance.status,'accepted');
 assert.deepEqual(acceptance.notes,[]);
 assert.equal(restoreNames(acceptance.value.lines[1]!,tokenized.names),'「小林家的狗」响了 3 次，像小朋友在拍手。');
 assert.equal(restoreNames(acceptance.value.tryThis!,tokenized.names),'把「王老师的铃」往后挪一点，听听会不会分开。');
});

test('work talk: a line that adds a fact, a sound, a term, a judgement or too many words falls back to the corpus',()=>{
 const bad=structuredClone(good);
 bad.lines[1]!.line='「声音1」响了 4 次，像小朋友在拍手。';
 bad.lines[2]!.line='「声音2」和「声音1」一起响。';
 bad.lines[3]!.line='「声音2」是长音，「声音3」是短音，两个声部一长一短。';
 bad.lines[4]!.line='中间安静了 3 秒，你做得真棒！';
 bad.lines[5]!.line='最后又是「声音1」，像小朋友放学以后背着书包绕着学校的大操场慢慢地跑了一大圈又一大圈，最后回到了自己家门口一样。';
 const {acceptance}=readWorkTalk(JSON.stringify(bad),workBrief);
 assert.equal(acceptance.status,'partly');
 assert.deepEqual(acceptance.value.lines.map(line=>line!==null),[true,false,false,false,false,false]);
 const notes=acceptance.notes.join('\n');
 assert.match(notes,/写了事实里没有的数字 4/);
 assert.match(notes,/没有的「声音1」/);
 assert.match(notes,/术语「声部」/);
 assert.match(notes,/「真棒」/);
 assert.match(notes,/超过上限 45/);
});

test('work talk: wrong order or kind, extra or missing lines, a wrong shape',()=>{
 const swapped={...good,lines:[good.lines[1],good.lines[0],...good.lines.slice(2),{kind:'rest',line:'多一句。'}]};
 const {acceptance}=readWorkTalk(JSON.stringify(swapped),workBrief);
 assert.deepEqual(acceptance.value.lines.slice(0,2),[null,null]);
 assert.match(acceptance.notes.join('\n'),/多出的 1 句已丢弃[\s\S]*第 1 条应该是 opening，回复写成了 repeat/);
 const short=readWorkTalk(JSON.stringify({...good,lines:good.lines.slice(0,2)}),workBrief).acceptance;
 assert.equal(short.status,'partly');
 assert.match(short.notes.join(),/第 3 条（together）没有写/);
 assert.equal(readWorkTalk('{"text":"好"}',workBrief).acceptance.status,'rejected');
 assert.equal(readWorkTalk('抱歉',workBrief).acceptance.status,'rejected');
});

test('textbook talk: the feature must name the song; each part falls back on its own',()=>{
 const reply={feature:'这首歌是三拍子，像摇篮在晃。',meeting:'你的「声音1」踩在拍子上。',task:'把一个声音往后挪一点，再听听。'};
 const {acceptance}=readTextbookTalk(JSON.stringify(reply),textbookBrief);
 assert.equal(acceptance.status,'partly');
 assert.equal(acceptance.value.feature,null);
 assert.match(acceptance.notes.join(),/没有提到歌名「摇篮曲」/);
 assert.equal(readTextbookTalk(JSON.stringify({...reply,feature:'「摇篮曲」是三拍子，像摇篮在晃。'}),textbookBrief).acceptance.status,'accepted');
 assert.equal(readTextbookTalk(JSON.stringify({...reply,meeting:'你的「声音2」踩在拍子上。'}),textbookBrief).acceptance.value.meeting,null);
});

test('AI compose: a plan inside the ranges is taken; anything outside is replaced by the program\'s and noted',()=>{
 const reference=buildBackgroundCompose(calmLullaby).prompt.match(/【程序的参考方案】速度 (\d+)，(\d) 拍/)!;
 const plan={tempo:Number(reference[1]),metre:Number(reference[2]),mode:'major',tonicShift:2,progressions:['1-4-1-5'],pattern:'block',bass:'hold',
  drums:'none',motif:{degrees:[0,2,1,4],beats:[1,1,1,2]},answer:'mirror',
  sections:[{density:'sparse',register:'mid',dynamics:'soft'},{density:'medium',register:'high',dynamics:'medium'},{density:'sparse',register:'mid',dynamics:'soft'},{density:'medium',register:'low',dynamics:'medium'}],style:'lullaby'};
 const good=readBackgroundCompose(JSON.stringify(plan),calmLullaby).acceptance;
 assert.equal(good.status,'accepted',good.notes.join());
 assert.deepEqual(good.value!.plan.motif,plan.motif);
 const wild=readBackgroundCompose(JSON.stringify({...plan,tempo:200,pattern:'rock',drums:'groove',motif:{degrees:[0,9.4,-12],beats:[.3,9,1]}}),calmLullaby).acceptance;
 assert.equal(wild.status,'partly');
 assert.ok(wild.value!.plan.tempo<=90,'tempo pulled into the calm range');
 assert.notEqual(wild.value!.plan.pattern,'rock');
 assert.notEqual(wild.value!.plan.drums,'groove','calm allows no groove');
 assert.deepEqual(wild.value!.plan.motif,{degrees:[0,7,-7],beats:[.5,2,1]});
 assert.match(wild.notes.join('；'),/速度改到/);
 assert.equal(readBackgroundCompose('not json',calmLullaby).acceptance.status,'rejected');
});

test('mood words, the textbook card words and hints: only the allowed answers',()=>{
 assert.deepEqual(readMoodWords('{"nearest":"sad"}').acceptance.value,{nearest:'sad'});
 assert.deepEqual(acceptMood({nearest:null}).value,{nearest:null});
 assert.equal(acceptMood({nearest:'homesick'}).status,'rejected');
 assert.deepEqual(readTextbookWords('{"mood":"calm","childLine":"像摇篮轻轻晃。"}').acceptance.value,{mood:'calm',childLine:'像摇篮轻轻晃'});
 assert.equal(acceptTextbookWords({mood:'calm',childLine:'这是一首三拍子的摇篮曲，节奏非常舒缓优美'}).status,'rejected');
 assert.equal(acceptTextbookWords({mood:'sleepy',childLine:'像摇篮轻轻晃'}).status,'rejected');
 assert.equal(acceptSoundHint({text:'高高的声音像口哨。'}).status,'accepted');
 assert.equal(acceptSoundHint({text:'你选得不对，应该选低低的。'}).status,'rejected');
});
