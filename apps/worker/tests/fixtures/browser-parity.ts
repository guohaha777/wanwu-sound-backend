import {renderShaped} from '@wanwu-v2/audio-engine/shaping';
import {renderBackground} from '@wanwu-v2/audio-engine/background';
import {renderShaped as legacyShaped} from './legacy/renderShaped.ts';
import {renderBackground as legacyBackground} from './legacy/renderBackground.ts';
import {analyseSamples} from '@wanwu-v2/sound-rules/analysis';
import {planCard} from '@wanwu-v2/sound-rules/shaping';
import {assignParts,backgroundPlan} from '@wanwu-v2/sound-rules/background';
import {LOCAL_INSTRUMENTS} from '@wanwu-v2/audio-engine/instruments';
import type {ChosenShape} from '@wanwu-v2/contracts/sound';

function difference(left:AudioBuffer,right:AudioBuffer){
 if(left.length!==right.length
  ||left.numberOfChannels!==right.numberOfChannels)throw new Error('different-render-length');
 let maximum=0;
 for(let c=0;c<left.numberOfChannels;c++){
  const a=left.getChannelData(c),b=right.getChannelData(c);
  for(let i=0;i<a.length;i++)maximum=Math.max(maximum,Math.abs(a[i]!-b[i]!));
 }
 return maximum;
}

export async function run(){
 const source=new OfflineAudioContext(2,1,48000).createBuffer(2,48000,48000);
 for(let c=0;c<2;c++){
  const samples=source.getChannelData(c);
  for(let i=0;i<samples.length;i++)samples[i]=.15*Math.sin(2*Math.PI*(440+c*110)*i/48000);
 }
 const original=source.getChannelData(0).slice();
 const analysis=analyseSamples([source.getChannelData(0),source.getChannelData(1)],source.sampleRate);
 const shapes:ChosenShape[]=[{},
  {pitch:'low'},{pitch:'high'},{duration:'short'},{duration:'long'},
  {contour:'rising'},{contour:'falling'},{contour:'wavy'},{intensity:'soft'},{intensity:'loud'},
  {pattern:'repeat'},{pattern:'bursts'},{pattern:'fade-in'},
  {pitch:'high',duration:'long',contour:'wavy',intensity:'loud',pattern:'bursts'},
 ];
 let maxShapingDifference=0;
 for(const shape of shapes){
  const plan=planCard(shape,analysis,'source:parity');
  maxShapingDifference=Math.max(maxShapingDifference,difference(await renderShaped(source,plan),await legacyShaped(source,plan)));
 }
 const plan=backgroundPlan({seconds:20,sounding:[{start:0,end:2},{start:10,end:13}],mood:'calm',textbook:null,seed:'work:parity'});
 let maxBackgroundDifference=0;
 const choices=[[],[LOCAL_INSTRUMENTS[0]!],[LOCAL_INSTRUMENTS[1]!],[LOCAL_INSTRUMENTS[2]!],[...LOCAL_INSTRUMENTS]];
 for(const chosen of choices){
  const parts=assignParts(chosen),voices=Object.fromEntries(chosen.map(instrument=>[instrument.id,instrument.recipe]));
  maxBackgroundDifference=Math.max(maxBackgroundDifference,difference(await renderBackground(plan,parts,voices),await legacyBackground(plan,parts,voices)));
 }
 let originalDifference=0;
 for(let i=0;i<original.length;i++)originalDifference=Math.max(originalDifference,Math.abs(original[i]!-source.getChannelData(0)[i]!));
 return {shapingCases:shapes.length,backgroundCases:choices.length,maxShapingDifference,maxBackgroundDifference,originalDifference};
}
