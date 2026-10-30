// 游客 AI: every route of the module, mounted by one line in app.ts. Visitors need no account; the app's existing
// hooks still require https, the exact Origin and the session CSRF token (from GET /auth/csrf) on every POST, so other
// sites cannot spend this budget through a visitor's browser. Facts and numbers come from the page's anonymous briefs;
// the model only rewords, chooses or writes a motif, and @wanwu-v2/prompts checks every reply as the page would.
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {MOODS} from '@wanwu-v2/contracts/arrangement';
import {AI_BACKGROUND_STEPS,isBackgroundBrief,parseBackgroundResult} from '@wanwu-v2/contracts/background';
import type {AiBackgroundStep,BackgroundBrief,BackgroundResult,BackgroundUnavailable} from '@wanwu-v2/contracts/background';
import {isTextbookTalkBrief,isWorkTalkBrief} from '@wanwu-v2/contracts/talk';
import {buildBackgroundNotes,buildMoodWords,buildTextbookTalk,buildWorkTalk,readBackgroundNotes,readMoodWords,readTextbookTalk,readWorkTalk} from '@wanwu-v2/prompts/tasks';
import type {BuiltPrompt} from '@wanwu-v2/prompts/tasks';
import {ApiError} from '../errors.ts';
import {developIdea} from './aiNotes.ts';
import type {GuestConfig,Provider} from './config.ts';
import {BackgroundJobs} from './jobs.ts';
import {DailyBudget,GUEST_RATE_LIMIT} from './limits.ts';
import {GuestFailure,postJson} from './net.ts';
import type {Post} from './net.ts';
import {OVERRIDE_HEADER,parseOverride} from './override.ts';
import {chat} from './providers/language.ts';
import {generateAudio} from './providers/music.ts';

/** Server waits a little less than the page (talk 6 s, AI notes 8 s, AI audio 60 s), so the page hears why. */
export const GUEST_TIMEOUT_MS={text:5_500,notes:7_000,audio:55_000} as const;
export type GuestContext={config:GuestConfig;post:Post;budget:DailyBudget;jobs:BackgroundJobs};
export const guestContext=(config:GuestConfig,post:Post=postJson):GuestContext=>({config,post,budget:new DailyBudget(config.dailyLimit),jobs:new BackgroundJobs()});

const exact=(value:unknown,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===[...keys].sort().join();

export function guestRoutes(app:FastifyInstance,context:GuestContext){
 const providers=(request:FastifyRequest)=>{
  const override=parseOverride(request.headers[OVERRIDE_HEADER]);
  if(override==='invalid')throw new ApiError(400,'invalid-request');
  return {language:override?.language??context.config.language,music:override?.music??context.config.music};
 };
 /** Built-in settings spend the daily budget; a visitor's own do not. */
 const spend=(provider:Provider)=>provider.builtIn&&!context.budget.take();
 const outcome=(request:FastifyRequest,task:string,started:number,result:string,provider:Provider|null)=>
  request.log.info({task,result,ms:Date.now()-started,model:provider?.builtIn?provider.model:provider?'visitor':null,requestId:request.id},'Wanwu guest AI');

 /** A text task: language model → reply text. Failures become the error bodies the page already reads. */
 const text=async(request:FastifyRequest,task:string,built:(provider:Provider)=>BuiltPrompt)=>{
  const started=Date.now(),{language}=providers(request);
  if(!language){outcome(request,task,started,'not-open',null);throw new ApiError(503,'not-open');}
  if(spend(language)){outcome(request,task,started,'quota',language);throw new ApiError(429,'rate-limited',context.budget.retryAfter());}
  const prompt=built(language);
  try{const reply=await chat(context.post,language,prompt,GUEST_TIMEOUT_MS.text);outcome(request,task,started,'ok',language);return {reply,model:language.model,promptVersion:prompt.version};}
  catch(error){
   const reason=error instanceof GuestFailure?error.reason:'failed';outcome(request,task,started,reason,language);
   if(reason==='quota')throw new ApiError(429,'rate-limited',60);
   if(reason==='timeout')throw new ApiError(504,'temporarily-unavailable');
   throw new ApiError(502,'failed');
  }
 };

 app.post('/api/v1/moods/interpret',GUEST_RATE_LIMIT,async request=>{
  const body=request.body as {text?:unknown};
  if(!exact(body,['text'])||typeof body.text!=='string')throw new ApiError(400,'invalid-request');
  const clean=body.text.trim(),length=[...clean].length;
  if(length<1||length>12)throw new ApiError(400,'invalid-request');
  const {reply,model,promptVersion}=await text(request,'mood-words',()=>buildMoodWords({text:clean}));
  const nearest=readMoodWords(reply).acceptance.value?.nearest??null;
  return {nearest:MOODS.includes(nearest as never)?nearest:null,model,promptVersion};
 });

 app.post('/api/v1/talk/work',GUEST_RATE_LIMIT,async request=>{
  const brief=request.body;if(!isWorkTalkBrief(brief))throw new ApiError(400,'invalid-request');
  const {reply,model,promptVersion}=await text(request,'work-talk',()=>buildWorkTalk(brief));
  const {lines,tryThis}=readWorkTalk(reply,brief).acceptance.value;
  return {lines,tryThis,model,promptVersion};
 });

 app.post('/api/v1/talk/textbook',GUEST_RATE_LIMIT,async request=>{
  const brief=request.body;if(!isTextbookTalkBrief(brief))throw new ApiError(400,'invalid-request');
  const {reply,model,promptVersion}=await text(request,'textbook-talk',()=>buildTextbookTalk(brief));
  return {...readTextbookTalk(reply,brief).acceptance.value,model,promptVersion};
 });

 const unavailable=(reason:BackgroundUnavailable):BackgroundResult=>({status:'unavailable',reason});
 const runStep=async(step:AiBackgroundStep,brief:BackgroundBrief,language:Provider|null,music:Provider|null):Promise<BackgroundResult>=>{
  // Teaching-music analysis is not open: a brief that needs it has no AI background.
  if(brief.teachingMusic)return unavailable('not-open');
  const provider=step==='audio-ai'?music:language;
  if(!provider)return unavailable('not-open');
  if(spend(provider))return unavailable('quota');
  try{
   if(step==='audio-ai')return parseBackgroundResult(await generateAudio(provider,brief),brief.seconds)??unavailable('failed');
   const prompt=buildBackgroundNotes(brief,context.jobs.attempt(brief.workId));
   const idea=readBackgroundNotes(await chat(context.post,provider,prompt,GUEST_TIMEOUT_MS.notes)).acceptance.value;
   if(!idea)return unavailable('failed');
   const result:BackgroundResult={status:'ready',source:'notes-ai',notes:developIdea(brief,idea),model:provider.builtIn?provider.model:'visitor',promptVersion:prompt.version};
   return parseBackgroundResult(result,brief.seconds)??unavailable('failed');
  }catch(error){return unavailable(error instanceof GuestFailure?error.reason:'failed');}
 };

 app.post('/api/v1/backgrounds',GUEST_RATE_LIMIT,async(request,reply)=>{
  const body=request.body as {step?:unknown;brief?:unknown};
  if(!exact(body,['brief','step'])||!AI_BACKGROUND_STEPS.includes(body.step as AiBackgroundStep)||!isBackgroundBrief(body.brief))throw new ApiError(400,'invalid-request');
  const step=body.step as AiBackgroundStep,brief=body.brief,started=Date.now(),{language,music}=providers(request);
  const jobId=context.jobs.start(async()=>{const result=await runStep(step,brief,language,music);
   outcome(request,step,started,result.status==='ready'?'ok':result.reason,step==='audio-ai'?music:language);return result;});
  if(!jobId)throw new ApiError(503,'busy');
  return reply.code(202).send({jobId});
 });

 app.get<{Params:{jobId:string}}>('/api/v1/backgrounds/:jobId',async request=>{
  if(!/^[a-f0-9-]{36}$/.test(request.params.jobId))throw new ApiError(400,'invalid-request');
  const state=context.jobs.get(request.params.jobId);if(!state)throw new ApiError(404,'not-found');
  return state;
 });
}
