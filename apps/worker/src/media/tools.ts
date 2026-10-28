import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
export type MediaTools={ffmpeg:string;ffprobe:string;signal?:AbortSignal};
export class MediaError extends Error{
 readonly reason:string;
 constructor(reason:string){super(reason);this.name='MediaError';this.reason=reason;}
}
export const MAX_SOURCE_BYTES=20*1024*1024;
export const MAX_SOURCE_SECONDS=45.5;
/** Reject playlists and network protocols before probing, not after decoding an external reference. */
export const INPUT_FLAGS=['-protocol_whitelist','file,pipe','-format_whitelist','wav,mp3,ogg,matroska,mov,aac'];

export async function runMediaTool(command:string,args:readonly string[],timeout=60_000,signal?:AbortSignal){
 try{return await execute(command,[...args],{timeout,signal,maxBuffer:256*1024,windowsHide:true,encoding:'utf8'});}
 catch(error){
  const problem=error as {code?:string;killed?:boolean};
  if(problem.code==='ENOENT')throw new MediaError('media-tool-unavailable');
  if(problem.killed||signal?.aborted)throw new MediaError('media-timeout');
  // Do not return FFmpeg stderr (which can contain paths and user metadata) through a future API.
  throw new MediaError('invalid-media');
 }
}

export async function toolVersions(tools:MediaTools){
 const [ffmpeg,ffprobe]=await Promise.all([runMediaTool(tools.ffmpeg,['-version']),runMediaTool(tools.ffprobe,['-version'])]);
 return {ffmpeg:ffmpeg.stdout.split('\n')[0]!,ffprobe:ffprobe.stdout.split('\n')[0]!};
}
