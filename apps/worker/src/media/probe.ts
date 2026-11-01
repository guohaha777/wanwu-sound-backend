import {INPUT_FLAGS,MediaError,runMediaTool} from './tools.ts';

export type AudioProbe={codec:string;channels:number;sampleRate:number;container:string;duration:number|null};
type Stream={codec_type?:string;codec_name?:string;channels?:number;sample_rate?:string};
export function validateProbe(raw:unknown):AudioProbe{
 const data=raw as {streams?:Stream[];format?:{format_name?:string;duration?:string}}|null;
 if(!data||!Array.isArray(data.streams)||data.streams.length!==1)throw new MediaError('unsupported-media');
 const stream=data.streams[0]!,container=data.format?.format_name??'',codec=stream.codec_name??'';
 const formats=container.split(',');
 const allowed=formats.includes('wav')&&/^pcm_(u8|s16le|s24le|s32le|f32le|f64le)$/.test(codec)
  ||formats.includes('mp3')&&codec==='mp3'
  ||formats.includes('ogg')&&['opus','vorbis'].includes(codec)
  ||formats.includes('matroska')&&['opus','vorbis'].includes(codec)
  ||formats.includes('mov')&&codec==='aac'||formats.includes('aac')&&codec==='aac';
 const channels=stream.channels??0,sampleRate=Number(stream.sample_rate),duration=Number(data.format?.duration);
 if(stream.codec_type!=='audio'||!allowed||!Number.isInteger(channels)||channels<1||channels>2
  ||!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new MediaError('unsupported-media');
 return {codec,channels,sampleRate,container,duration:Number.isFinite(duration)&&duration>0?duration:null};
}
export async function probeAudio(file:string,ffprobe:string,signal?:AbortSignal){
 const result=await runMediaTool(ffprobe,['-v','error',...INPUT_FLAGS,'-show_entries',
  'format=format_name,duration:stream=codec_type,codec_name,channels,sample_rate','-of','json','-i',file],60_000,signal);
 try{return validateProbe(JSON.parse(result.stdout));}
 catch(error){
  if(error instanceof MediaError)throw error;
  throw new MediaError('invalid-media');
 }
}
