import {renderWork,RENDERER_VERSION,TIMBRE_VERSION} from '@wanwu-v2/audio-engine/render';
import type {RenderInput} from '@wanwu-v2/audio-engine/render';
import {pcm16Wave,pcmMetrics,RENDER_SAMPLE_RATE} from '@wanwu-v2/audio-engine/pcm';
import {RESULT_CHUNK_BYTES} from './result-transfer.ts';

export async function render(input:RenderInput){
 const buffers=new Map<string,AudioBuffer>();
 // Decoding does not need one unfinished OfflineAudioContext per source.
 // Reuse one per job; completed shaping contexts remain independently timed.
 const decoder=new OfflineAudioContext(1,1,RENDER_SAMPLE_RATE);
 const load=async(id:string)=>{
  let buffer=buffers.get(id);
  if(!buffer){
   const response=await fetch(`/sources/${encodeURIComponent(id)}`);
   if(!response.ok)throw new Error('missing-source');
   buffer=await decoder.decodeAudioData(await response.arrayBuffer());
   buffers.set(id,buffer);
   while(buffers.size>2)buffers.delete(buffers.keys().next().value!);
  }
  return buffer;
 };
 let steps=0;
 const release=async()=>{
  await new Promise<void>(done=>setTimeout(done,0));
  ++steps;
  const progress=(globalThis as unknown as {wanwuProgress?:(step:number)=>Promise<void>}).wanwuProgress;
  await progress?.(steps);
 };
 const result=await renderWork(input,load,release);
 buffers.clear();
 await release();
 const channels=Array.from({length:result.numberOfChannels},(_,c)=>result.getChannelData(c));
 const metrics=pcmMetrics(channels);
 // Binary transfer, not millions of JSON numbers copied through the browser driver.
 const bytes=pcm16Wave(channels,result.sampleRate);
 for(let offset=0;offset<bytes.length;offset+=RESULT_CHUNK_BYTES){
  const response=await fetch(`/result?offset=${offset}&total=${bytes.length}`,{method:'POST',body:bytes.subarray(offset,offset+RESULT_CHUNK_BYTES)});
  if(!response.ok)throw new Error('result-transfer-failed');
 }
 return {duration:result.duration,sampleRate:result.sampleRate,channels:result.numberOfChannels,
  ...metrics,rendererVersion:RENDERER_VERSION,timbreVersion:TIMBRE_VERSION};
}
