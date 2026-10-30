import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import {parseBackgroundResult} from '@wanwu-v2/contracts/background';
import type {BackgroundBrief} from '@wanwu-v2/contracts/background';
import {ApiError} from '../../src/errors.ts';
import {developIdea} from '../../src/guest/aiNotes.ts';
import {readGuestConfig} from '../../src/guest/config.ts';
import type {GuestConfig} from '../../src/guest/config.ts';
import {DailyBudget} from '../../src/guest/limits.ts';
import {GuestFailure,postJson,publicAddress} from '../../src/guest/net.ts';
import type {Post} from '../../src/guest/net.ts';
import {OVERRIDE_HEADER,parseOverride} from '../../src/guest/override.ts';
import {guestContext,guestRoutes} from '../../src/guest/routes.ts';
import {BACKGROUND_BRIEFS,PERSONAL_NAMES,calmLullaby,textbookBrief,workBrief} from '../../../../packages/prompts/tests/fixtures/briefs.ts';

const key='sk-test-not-a-real-key-123456';
const language={baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3.8-flash',apiKey:key,builtIn:true};
const audio={...language,model:'qwen3.8-omni-flash'};
const config:GuestConfig={language,music:null,audio,dailyLimit:100};
const idea={motifDegrees:[0,2,4,2],motifBeats:[1,0.5,0.5,2],sections:[{density:'sparse',register:'mid'},{density:'medium',register:'high'},{density:'busy',register:'mid'},{density:'sparse',register:'low'}],bassPulse:'steady'};
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64');

type Call={url:string;headers:Record<string,string>;body:{model:string;messages:{content:any}[];enable_thinking?:boolean}};
/** A fake chat/completions service: answers each task with what a good model would send. */
function fakeModel(answer:(prompt:string)=>unknown,calls:Call[]=[]):Post{
 return async(url,headers,body)=>{
  const call={url,headers,body} as Call;calls.push(call);
  // Audio requests carry [input_audio, text] parts; the fake reads their text.
  const text=(content:unknown)=>typeof content==='string'?content:Array.isArray(content)?content.map(part=>part?.text??'').join('\n'):'';
  const prompt=call.body.messages.map(message=>text(message.content)).join('\n'),value=answer(prompt);
  if(value instanceof GuestFailure)throw value;
  if(typeof value==='number')return {status:value,json:null};
  return {status:200,json:{choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)}}]}};
 };
}
const good=(prompt:string)=>prompt.includes('motifDegrees')?idea
 :prompt.includes('feature')?{feature:'《摇篮曲》是三拍子，嗒— 嗒，像摇篮轻轻晃。',shape:'这次唱低一点，听起来更暖。',meeting:'「声音1」和重拍碰在一起。',task:'跟着拍手试一试。'}
 :prompt.includes('tryThis')?{lines:workBrief.facts.map(fact=>({kind:fact.kind,line:'这里听起来很有意思。'})),tryThis:'再听一遍试试。'}
 :{nearest:'calm'};

async function app(post:Post,options:Partial<GuestConfig>={}){
 const server=Fastify();
 await server.register(rateLimit,{global:false});
 server.setErrorHandler((error,_request,reply)=>error instanceof ApiError?reply.code(error.status).send({status:'error',reason:error.reason}):reply.code((error as {statusCode?:number}).statusCode??500).send({status:'error',reason:'internal-error'}));
 const context=guestContext({...config,...options},post);
 guestRoutes(server,context);await server.ready();return {server,context};
}
async function background(server:Awaited<ReturnType<typeof app>>['server'],step:string,brief:BackgroundBrief=calmLullaby,headers:Record<string,string>={}){
 const start=await server.inject({method:'POST',url:'/api/v1/backgrounds',payload:{step,brief},headers});
 assert.equal(start.statusCode,202);
 const {jobId}=start.json() as {jobId:string};
 for(let i=0;i<50;i++){
  const state=(await server.inject({method:'GET',url:`/api/v1/backgrounds/${jobId}`})).json() as {status:string};
  if(state.status!=='pending')return state;
  await new Promise(resolve=>setTimeout(resolve,5));
 }
 throw new Error('job did not finish');
}

test('only public addresses are allowed for model calls',()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','172.22.0.1','192.168.1.1','169.254.169.254','100.100.100.200','198.18.0.5','0.0.0.0','::1','fd00::1','fe80::1','::ffff:127.0.0.1'])assert.equal(publicAddress(ip),false,ip);
 for(const ip of ['8.130.95.57','47.96.1.1','2400:3200::1'])assert.equal(publicAddress(ip),true,ip);
 assert.equal(publicAddress('dashscope.aliyuncs.com'),false);
});

test('the real client refuses plain http, private literals and names that resolve to this machine',async()=>{
 for(const url of ['http://example.com/v1','https://127.0.0.1:9/x','https://[::1]:9/x','https://localhost:9/x'])
  await assert.rejects(postJson(url,{},{},2000),(error:unknown)=>error instanceof GuestFailure&&error.reason==='failed',url);
});

test('built-in settings come from their own variables; the music model may stay empty',()=>{
 assert.deepEqual(readGuestConfig({}),{language:null,music:null,audio:null,dailyLimit:2000});
 const read=readGuestConfig({WANWU_LLM_BASE_URL:language.baseUrl+'/',WANWU_LLM_MODEL:'qwen3.8-flash',WANWU_LLM_API_KEY:key,WANWU_GUEST_AI_DAILY_LIMIT:'50'});
 assert.equal(read.language?.baseUrl,language.baseUrl);assert.equal(read.music,null);assert.equal(read.audio,null);assert.equal(read.dailyLimit,50);
 assert.equal(readGuestConfig({WANWU_LLM_BASE_URL:language.baseUrl,WANWU_LLM_MODEL:'qwen3.8-flash',WANWU_LLM_API_KEY:key,WANWU_AUDIO_MODEL:'qwen3.8-omni-flash'}).audio?.model,'qwen3.8-omni-flash');
 assert.throws(()=>readGuestConfig({WANWU_AUDIO_MODEL:'qwen3.8-omni-flash'}),/WANWU_LLM/);
 assert.throws(()=>readGuestConfig({WANWU_LLM_BASE_URL:'http://example.com/v1',WANWU_LLM_MODEL:'m',WANWU_LLM_API_KEY:key}));
 assert.throws(()=>readGuestConfig({WANWU_LLM_MODEL:'qwen3.8-flash'}));
 assert.throws(()=>readGuestConfig({WANWU_MUSIC_PROVIDER:'other'}));
});

test('a visitor override replaces only the kinds it names and refuses anything not exactly right',()=>{
 const own={baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat',apiKey:key};
 const parsed=parseOverride(encode({language:own}));
 assert.ok(parsed&&parsed!=='invalid');assert.equal(parsed.language?.builtIn,false);assert.equal(parsed.music,undefined);
 assert.equal(parseOverride(undefined),null);
 for(const bad of [{language:{...own,baseUrl:'http://api.deepseek.com/v1'}},{language:{...own,baseUrl:'https://127.0.0.1/v1'}},{language:{...own,baseUrl:'https://localhost/v1'}},
  {language:{...own,baseUrl:'https://[::1]/v1'}},{language:{...own,baseUrl:'https://user:pw@api.deepseek.com/v1'}},{language:{...own,extra:1}},{other:own},{},{language:{...own,apiKey:'short'}}])
  assert.equal(parseOverride(encode(bad)),'invalid',JSON.stringify(bad));
 assert.equal(parseOverride('not base64!'),'invalid');
});

test('the daily budget resets at midnight in Asia/Shanghai',()=>{
 let now=new Date('2026-10-30T15:59:00Z');const budget=new DailyBudget(2,()=>now);
 assert.equal(budget.take(),true);assert.equal(budget.take(),true);assert.equal(budget.take(),false);
 assert.equal(budget.retryAfter(),60);
 now=new Date('2026-10-30T16:00:01Z');assert.equal(budget.take(),true);
});

test('status says which built-in models are set up, nothing more',async()=>{
 const {server}=await app(fakeModel(good));
 assert.deepEqual((await server.inject({method:'GET',url:'/api/v1/guest/status'})).json(),{language:true,music:false,audio:true});
 const closed=await app(fakeModel(good),{language:null,audio:null});
 assert.deepEqual((await closed.server.inject({method:'GET',url:'/api/v1/guest/status'})).json(),{language:false,music:false,audio:false});
});

test('mood words: the model only chooses a preset, thinking is off on 百炼, the key never leaves the auth header',async()=>{
 const calls:Call[]=[];const {server}=await app(fakeModel(good,calls));
 const reply=await server.inject({method:'POST',url:'/api/v1/moods/interpret',payload:{text:' 有点想睡觉 '}});
 assert.equal(reply.statusCode,200);assert.deepEqual(reply.json(),{nearest:'calm',model:'qwen3.8-flash',promptVersion:'mood-words-prompt-v1'});
 assert.equal(calls[0]!.url,`${language.baseUrl}/chat/completions`);assert.equal(calls[0]!.body.enable_thinking,false);
 assert.equal(calls[0]!.headers.authorization,`Bearer ${key}`);assert.equal(JSON.stringify(calls[0]!.body).includes(key),false);
 for(const text of ['','一二三四五六七八九十一二三',3])assert.equal((await server.inject({method:'POST',url:'/api/v1/moods/interpret',payload:{text}})).statusCode,400);
 const odd=await app(fakeModel(()=>({nearest:'sleepy'})));
 assert.equal((await odd.server.inject({method:'POST',url:'/api/v1/moods/interpret',payload:{text:'困'}})).json().nearest,null);
});

test('talk: replies in the protocol shape for the page to check again; unusable replies fail',async()=>{
 const calls:Call[]=[];const {server}=await app(fakeModel(good,calls));
 const work=await server.inject({method:'POST',url:'/api/v1/talk/work',payload:workBrief});
 assert.equal(work.statusCode,200);const body=work.json() as {lines:{kind:string;line:string}[];tryThis:string;promptVersion:string};
 assert.equal(body.lines.length,workBrief.facts.length);assert.equal(body.lines[0]!.kind,workBrief.facts[0]!.kind);assert.equal(body.promptVersion,'work-talk-prompt-v1');
 for(const name of PERSONAL_NAMES)assert.equal(JSON.stringify(calls).includes(name),false,'names never reach the model');
 const textbook=await server.inject({method:'POST',url:'/api/v1/talk/textbook',payload:textbookBrief});
 assert.equal(textbook.statusCode,200);assert.ok('feature' in (textbook.json() as object));
 const bad=await app(fakeModel(()=>'这不是 JSON'));
 assert.equal((await bad.server.inject({method:'POST',url:'/api/v1/talk/work',payload:workBrief})).statusCode,502);
 assert.equal((await bad.server.inject({method:'POST',url:'/api/v1/talk/textbook',payload:textbookBrief})).statusCode,502);
 assert.equal((await server.inject({method:'POST',url:'/api/v1/talk/work',payload:{...workBrief,facts:[]}})).statusCode,400);
});

test('failures become the reasons the page already handles',async()=>{
 const closed=await app(fakeModel(good),{language:null});
 assert.equal((await closed.server.inject({method:'POST',url:'/api/v1/moods/interpret',payload:{text:'开心'}})).json().reason,'not-open');
 const slow=await app(fakeModel(()=>new GuestFailure('timeout')));
 assert.equal((await slow.server.inject({method:'POST',url:'/api/v1/moods/interpret',payload:{text:'开心'}})).statusCode,504);
 const limited=await app(fakeModel(()=>429));
 assert.equal((await limited.server.inject({method:'POST',url:'/api/v1/moods/interpret',payload:{text:'开心'}})).statusCode,429);
 const broken=await app(fakeModel(()=>500));
 assert.equal((await broken.server.inject({method:'POST',url:'/api/v1/moods/interpret',payload:{text:'开心'}})).statusCode,502);
 const spent=await app(fakeModel(good),{dailyLimit:1});
 assert.equal((await spent.server.inject({method:'POST',url:'/api/v1/moods/interpret',payload:{text:'开心'}})).statusCode,200);
 const over=await spent.server.inject({method:'POST',url:'/api/v1/moods/interpret',payload:{text:'开心'}});
 assert.equal(over.statusCode,429);assert.ok(Number(over.headers['retry-after'])>0||over.json().reason==='rate-limited');
 assert.equal((await spent.server.inject({method:'POST',url:'/api/v1/moods/interpret',payload:{text:'开心'},headers:{[OVERRIDE_HEADER]:'%%%'}})).statusCode,400);
});

test('a visitor override is used for its kind and does not spend the built-in budget',async()=>{
 const calls:Call[]=[];const {server}=await app(fakeModel(good,calls),{dailyLimit:0});
 const own={baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat',apiKey:key};
 const reply=await server.inject({method:'POST',url:'/api/v1/moods/interpret',payload:{text:'开心'},headers:{[OVERRIDE_HEADER]:encode({language:own})}});
 assert.equal(reply.statusCode,200);assert.equal(calls[0]!.url,'https://api.deepseek.com/v1/chat/completions');
 assert.equal(calls[0]!.body.model,'deepseek-chat');assert.equal('enable_thinking' in calls[0]!.body,false);
});

test('AI notes: the idea is developed with the local harmony, inside the piece, avoiding the child where it can',async()=>{
 for(const brief of BACKGROUND_BRIEFS){
  const notes=developIdea(brief,idea as never);
  assert.ok(parseBackgroundResult({status:'ready',source:'notes-ai',notes,model:'m',promptVersion:'p'},brief.seconds),brief.workId);
  assert.deepEqual(developIdea(brief,idea as never),notes,'same brief and idea, same notes');
  const melody=notes.filter(note=>note.part==='melody');
  assert.ok(melody.every(note=>note.midi>=36&&note.midi<=96));
  for(const note of melody.slice(0,-1))assert.ok(!brief.sounding.some(span=>note.at<span.end&&note.at+note.length>span.start),`${brief.workId} melody stays out of the child's sounds`);
 }
 const none=developIdea(calmLullaby,{...idea,bassPulse:'none'} as never);
 assert.equal(none.some(note=>note.part==='bass'),false);
});

test('background jobs: notes-ai ready, audio-ai not open yet, failures and teaching music fall through',async()=>{
 const {server}=await app(fakeModel(good));
 const ready=await background(server,'notes-ai') as {status:string;source:string;notes:unknown[];promptVersion:string};
 assert.equal(ready.status,'ready');assert.equal(ready.source,'notes-ai');assert.ok(ready.notes.length>0);assert.equal(ready.promptVersion,'background-notes-prompt-v1');
 assert.deepEqual(await background(server,'audio-ai'),{status:'unavailable',reason:'not-open'});
 assert.deepEqual(await background(server,'notes-ai',{...calmLullaby,textbook:null,variation:null,teachingMusic:{musicId:'m1'}}),{status:'unavailable',reason:'not-open'});
 const bad=await app(fakeModel(()=>({motifDegrees:[1],motifBeats:[1]})));
 assert.deepEqual(await background(bad.server,'notes-ai'),{status:'unavailable',reason:'failed'});
 const slow=await app(fakeModel(()=>new GuestFailure('timeout')));
 assert.deepEqual(await background(slow.server,'notes-ai'),{status:'unavailable',reason:'timeout'});
 assert.equal((await server.inject({method:'POST',url:'/api/v1/backgrounds',payload:{step:'local-rules',brief:calmLullaby}})).statusCode,400);
 assert.equal((await server.inject({method:'GET',url:'/api/v1/backgrounds/00000000-0000-0000-0000-000000000000'})).statusCode,404);
});

const featuresBrief={title:'小鸟在唱歌',listenSeconds:30,tempoBpm:96,meter:2,meterConfidence:.29,mode:'major',onsetDensity:'medium',brightness:'mid',
 candidates:[{cell:[.5,.5,.5,.5],bars:51},{cell:[.5,.5,1],bars:4}],fallbackCell:[.5,.5,.25,.75],others:[]};
const featuresReply={rhythmCell:[.5,.5,1],meter:2,tempo:'same',mood:'lively',childLine:'像小鸟蹦蹦跳跳',teacherNote:'先两下快的再一下长的，带孩子拍手念“小鸟—叫”。'};
const isAudio=(call:Call)=>Array.isArray(call.body.messages.at(-1)!.content);

test('textbook features: the audio model hears the excerpt; its checked answer comes back',async()=>{
 const calls:Call[]=[];const {server}=await app(fakeModel(()=>featuresReply,calls));
 const reply=await server.inject({method:'POST',url:'/api/v1/textbook/features',payload:{brief:featuresBrief,audio:Buffer.from('fake mp3').toString('base64')}});
 assert.equal(reply.statusCode,200);
 const body=reply.json() as {rhythmCell:number[];source:string;model:string;childLine:string;tempoBpm:number;promptVersion:string};
 assert.deepEqual(body.rhythmCell,[.5,.5,1]);assert.equal(body.source,'audio');assert.equal(body.model,'qwen3.8-omni-flash');assert.equal(body.tempoBpm,96);
 assert.equal(body.promptVersion,'textbook-features-prompt-v1');
 assert.equal(calls.length,1);assert.ok(isAudio(calls[0]!));assert.equal((calls[0]!.body as unknown as {reasoning_effort:string}).reasoning_effort,'none');
});

test('textbook features: no excerpt, or the audio model failing, falls to the language model with numbers only; neither → 502',async()=>{
 const calls:Call[]=[];const {server}=await app(fakeModel(()=>featuresReply,calls));
 const numbersOnly=(await server.inject({method:'POST',url:'/api/v1/textbook/features',payload:{brief:featuresBrief}})).json() as {source:string};
 assert.equal(numbersOnly.source,'language');assert.equal(isAudio(calls[0]!),false);assert.ok(calls[0]!.body.messages.at(-1)!.content.includes('没有附音频'));
 const deaf=await app(fakeModel(prompt=>prompt.includes('附带的这段音频')?new GuestFailure('timeout'):featuresReply));
 assert.equal(((await deaf.server.inject({method:'POST',url:'/api/v1/textbook/features',payload:{brief:featuresBrief,audio:'AAAA'}})).json() as {source:string}).source,'language');
 const broken=await app(fakeModel(()=>'不知道'));
 assert.equal((await broken.server.inject({method:'POST',url:'/api/v1/textbook/features',payload:{brief:featuresBrief,audio:'AAAA'}})).statusCode,502);
 const closed=await app(fakeModel(good),{language:null,audio:null});
 assert.equal((await closed.server.inject({method:'POST',url:'/api/v1/textbook/features',payload:{brief:featuresBrief}})).statusCode,503);
 for(const payload of [{brief:{...featuresBrief,meter:7}},{brief:featuresBrief,audio:'not base64!'},{brief:featuresBrief,audio:'A'.repeat(1_300_000)},{brief:featuresBrief,extra:1}])
  assert.equal((await server.inject({method:'POST',url:'/api/v1/textbook/features',payload})).statusCode,payload.audio?.length===1_300_000?413:400);
});
