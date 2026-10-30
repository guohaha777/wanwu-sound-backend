// @wanwu-v2/music-features: numbers for a textbook feature card, measured from a recording (measure.ts), and the
// program's own choices for when no model answers in time (pickRhythm, modelExcerpt).
export {MEASURE_VERSION,measure} from './measure.ts';
export type {Measurement,RhythmCandidate} from './measure.ts';
import type {RhythmCandidate} from './measure.ts';

/**
 * The program's choice of the song's characteristic rhythm: a pattern that recurs, preferring one whose notes are not
 * all the same length (an even pulse like 嗒嗒嗒嗒 fits any song, so it tells the least). Falls back to the plain beat.
 */
export function pickRhythm(candidates:readonly RhythmCandidate[],meter:number):number[]{
 let best:RhythmCandidate|null=null,bestScore=-1;
 for(const candidate of candidates){
  // An even pulse counts for less than half: it is everywhere in a recording (accompaniment), so it wins on numbers alone.
  const variety=new Set(candidate.cell).size-1,score=candidate.bars*(variety?1+.6*Math.min(2,variety):.4);
  if(score>bestScore){bestScore=score;best=candidate;}
 }
 return best?[...best.cell]:new Array<number>(meter).fill(1);
}

/** The part of the recording the audio model listens to: 30 s, skipping a short intro when the song is long enough. */
export function modelExcerpt(seconds:number,length=30){
 const start=seconds>length+12?10:Math.max(0,seconds-length)/2;
 return {start:Math.round(start*10)/10,end:Math.round(Math.min(seconds,start+length)*10)/10};
}
