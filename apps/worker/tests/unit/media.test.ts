import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProbe} from '../../src/media/probe.ts';
import {INPUT_FLAGS,MAX_SOURCE_BYTES,MAX_SOURCE_SECONDS} from '../../src/media/tools.ts';

const probe=(codec:string,format:string,channels=1)=>({streams:[{codec_type:'audio',codec_name:codec,channels,sample_rate:'48000'}],format:{format_name:format,duration:'1'}});
test('allow supported real container/codec combinations, not filenames or MIME claims',()=>{
 for(const [codec,container] of [['opus','matroska,webm'],['aac','mov,mp4,m4a,3gp,3g2,mj2'],['vorbis','ogg'],['mp3','mp3'],['pcm_s16le','wav']]){
  assert.equal(validateProbe(probe(codec!,container!)).codec,codec);
 }
 assert.throws(()=>validateProbe(probe('aac','hls')),/unsupported-media/);
 assert.throws(()=>validateProbe(probe('adpcm_ima_wav','wav')),/unsupported-media/);
 assert.throws(()=>validateProbe(probe('opus','ogg',8)),/unsupported-media/);
 assert.throws(()=>validateProbe({...probe('aac','mov'),streams:[{codec_type:'video'}]}),/unsupported-media/);
 assert.throws(()=>validateProbe(null),/unsupported-media/);
});
test('bounded local decoding does not allow network protocols or playlist demuxers',()=>{
 assert.equal(MAX_SOURCE_BYTES,20*1024*1024);assert.equal(MAX_SOURCE_SECONDS,45.5);
 assert.equal(INPUT_FLAGS[1],'file,pipe');assert.ok(!INPUT_FLAGS[3]!.includes('hls'));
});
