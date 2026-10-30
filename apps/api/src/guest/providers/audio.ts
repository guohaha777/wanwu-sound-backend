// Audio-understanding model (qwen3.8-omni-flash on 百炼, OpenAI-compatible): hears a short mp3 excerpt the page cut
// from a teacher's recording, plus the prompt. Thinking is off (reasoning_effort none) to keep it within seconds; the
// reply is JSON, checked by @wanwu-v2/prompts like every other task. The excerpt is sent for this request only.
import type {BuiltPrompt} from '@wanwu-v2/prompts/tasks';
import type {Provider} from '../config.ts';
import {GuestFailure} from '../net.ts';
import type {Post} from '../net.ts';

export async function chatWithAudio(post:Post,provider:Provider,built:BuiltPrompt,mp3Base64:string,timeoutMs:number):Promise<string>{
 const body={
  model:provider.model,temperature:built.temperature,modalities:['text'],response_format:{type:'json_object'},reasoning_effort:'none',stream:false,
  messages:[...(built.system?[{role:'system',content:built.system}]:[]),
   {role:'user',content:[{type:'input_audio',input_audio:{data:`data:;base64,${mp3Base64}`,format:'mp3'}},{type:'text',text:built.prompt}]}],
 };
 const reply=await post(`${provider.baseUrl}/chat/completions`,{authorization:`Bearer ${provider.apiKey}`},body,timeoutMs);
 if(reply.status===429)throw new GuestFailure('quota');
 if(reply.status<200||reply.status>=300)throw new GuestFailure('failed');
 const content=(reply.json as {choices?:{message?:{content?:unknown}}[]}|null)?.choices?.[0]?.message?.content;
 if(typeof content!=='string'||!content.trim())throw new GuestFailure('failed');
 return content;
}
