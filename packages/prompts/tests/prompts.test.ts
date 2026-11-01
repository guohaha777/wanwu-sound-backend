import test from 'node:test';
import assert from 'node:assert/strict';
import {STYLE} from '../src/style.ts';
import {PROMPT_VERSIONS,TASKS,TASK_IDS,buildBackgroundAudio,buildBackgroundCompose,buildMoodWords,buildSoundHint,buildTextbookTalk,buildTextbookWords,buildWorkTalk,promptProblems} from '../src/tasks/index.ts';
import type {BuiltPrompt,PromptFile} from '../src/tasks/index.ts';
import {WORK_TALK_PROMPT} from '../src/tasks/talk.ts';
import {BACKGROUND_BRIEFS,PERSONAL_NAMES,busyNoSong,calmLullaby,lullabyFeatures,quietNoMood,textbookBrief,workBrief} from './fixtures/briefs.ts';

/** Every request built from the fixed samples. */
const built:[string,BuiltPrompt][]=[
 ...BACKGROUND_BRIEFS.flatMap((brief,i)=>[[`background-audio#${i}`,buildBackgroundAudio(brief)],[`background-compose#${i}`,buildBackgroundCompose(brief)]] as [string,BuiltPrompt][]),
 ['work-talk',buildWorkTalk(workBrief)],['textbook-talk',buildTextbookTalk(textbookBrief)],
 ['sound-hint',buildSoundHint({dimension:'pattern',value:'repeat',kind:'texture'})],['mood-words',buildMoodWords({text:'有点想家'})],
 ['textbook-words',buildTextbookWords({...lullabyFeatures,title:'摇篮曲',others:[{title:'小火车',tempoBpm:116,rhythmCell:[.5,.5,1],childLine:'越跑越欢快'}]})],
];

test('every prompt file loads; each task has a version and a fallback',()=>{
 for(const id of TASK_IDS){
  assert.match(TASKS[id].file.version,/-v\d+$/,id);
  assert.ok(TASKS[id].fallback,id);
 }
 assert.equal(new Set(Object.values(PROMPT_VERSIONS)).size,TASK_IDS.length+2,'versions are distinct');
 assert.equal(TASKS['sound-hint'].file.status,'closed','向导联想 answers from the corpus for now');
});

test('a bad prompt edit is reported in plain words',()=>{
 const spec={task:'work-talk',model:'language' as const,placeholders:['seconds'],tables:{'words.mood':['none','happy']}};
 const file={...structuredClone(WORK_TALK_PROMPT),lines:['长 {second} 秒'],words:{mood:{none:'没选',hapy:'开心'}}} as PromptFile;
 const problems=promptProblems(file,spec).join('\n');
 assert.match(problems,/work-talk\.lines\[0\] 用了不认识的占位符 \{second\}/);
 assert.match(problems,/words\.mood\.happy 缺少/);
 assert.match(problems,/words\.mood\.hapy 不认识/);
 assert.match(promptProblems({...file,task:'x',temperature:3},spec).join('\n'),/task 应该是 work-talk[\s\S]*temperature 应该在 0–1.5/);
});

test('built prompts: every placeholder filled, nothing personal, within budget',()=>{
 for(const [name,prompt] of built){
  const text=`${prompt.system??''}\n${prompt.prompt}`;
  assert.doesNotMatch(text,/\{[A-Za-z]+\}/,`${name} left a placeholder`);
  for(const person of PERSONAL_NAMES)assert.ok(!text.includes(person),`${name} carries a child's sound name`);
  assert.ok(!text.includes('work:fixture'),`${name} carries the work id`);
  assert.ok(prompt.prompt.length<2200,`${name} is ${prompt.prompt.length} characters`);
 }
});

test('language tasks share the system prompt with the style words; the music model gets a plain description',()=>{
 const talk=buildWorkTalk(workBrief),audio=buildBackgroundAudio(calmLullaby);
 for(const word of [...STYLE.childAvoid,...STYLE.neverSay])assert.ok(talk.system!.includes(word),word);
 assert.match(talk.system!,/只返回一个合法的 JSON 对象/);
 assert.equal(audio.system,null);
 assert.doesNotMatch(audio.prompt,/\n/);
 assert.match(audio.prompt,/长度 30 秒/);
 assert.match(audio.prompt,/不要人声/);
 assert.match(audio.prompt,/约占全曲 27%/);
});

test('work talk: each fact with its local sentence, sounds only as tokens',()=>{
 const {prompt}=buildWorkTalk(workBrief);
 assert.match(prompt,/1\. kind=opening｜first=声音1，next=声音2｜本地说法：「声音1」先出现，「声音2」随后跟上。/);
 assert.match(prompt,/kind=long-short｜long=声音2，longSeconds=6\.2/);
 assert.match(prompt,/课本歌曲：「摇篮曲」/);
 assert.match(prompt,/不超过 45 个字/);
});

test('AI compose: every sound with its features as words, the ranges, the style card and the program\'s reference',()=>{
 const built=buildBackgroundCompose(calmLullaby);
 assert.match(built.prompt,/· 声音1 第 1–3 秒：高、中等长、往上走、轻、出现一次、单个的声音、不明不暗/);
 assert.match(built.prompt,/· 声音2 第 2–5 秒：高、长、走向没选、不轻不响、出现一次、连成一片的声音、不明不暗/);
 assert.match(built.prompt,/心情：平静/);
 assert.match(built.prompt,/拍子 3（三拍子）、4（四拍子）/);
 assert.match(built.prompt,/【风格卡】[a-z]+「/);
 assert.match(built.prompt,/【程序的参考方案】速度 \d+/);
 assert.match(built.prompt,/【上一首】第一次，没有上一首/);
 assert.doesNotMatch(built.prompt,/第 \d+ 首伴奏/);
 // The composer's role is added to the shared system prompt.
 assert.match(built.system!,/只返回一个合法的 JSON 对象/);
 assert.match(built.system!,/你是给小学低年级孩子的作品写伴奏的作曲家/);
 assert.equal(built.temperature,.9);
});

test('AI compose: asking again carries what the last one chose and asks for four changes',()=>{
 const reference=(prompt:string)=>prompt.match(/【程序的参考方案】(.+)/)![1]!;
 const first=reference(buildBackgroundCompose(busyNoSong).prompt);
 const again=buildBackgroundCompose({...busyNoSong,attempt:2,previous:{tempo:100,metre:4,mode:'major',tonicShift:0,progressions:['1-5-6-4'],
  pattern:'ostinato',bass:'pulse',drums:'march',motif:{degrees:[0,2,4],beats:[.5,.5,1]},answer:'mirror',
  sections:[{density:'sparse',register:'mid',dynamics:'soft'},{density:'sparse',register:'high',dynamics:'soft'},{density:'medium',register:'mid',dynamics:'soft'},{density:'sparse',register:'low',dynamics:'soft'}],style:'march'}}).prompt;
 assert.match(again,/【上一首】速度 100，4 拍，major/);
 assert.match(again,/这是为这首小曲写的第 3 首伴奏：至少换 4 项/);
 assert.notEqual(reference(again),first,'the reference changes with the try');
});

test('AI backgrounds follow the child\'s mood only, never a song',()=>{
 assert.match(buildBackgroundAudio(calmLullaby).prompt,/情绪：平静、舒展/);
 assert.match(buildBackgroundAudio(quietNoMood).prompt,/情绪：自然、中性/);
 for(const brief of BACKGROUND_BRIEFS)assert.doesNotMatch(buildBackgroundCompose(brief).prompt,/课本/);
});
