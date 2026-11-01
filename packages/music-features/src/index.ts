// @wanwu-v2/music-features: numbers for a textbook feature card, measured from a recording (measure.ts), and the
// program's own choices for when no model answers in time (pickRhythm, pickMood, modelExcerpt).
export {MEASURE_VERSION,measure} from './measure.ts';
/**
 * The rate to decode a recording at before measuring it. measure steps through it in whole frames after an integer
 * downsample (44.1 kHz → 22.05 kHz), and its thresholds were set there; a browser decoding at 48 kHz lands on another
 * frame grid and real songs then measure differently (2026-10-31: 小鸟在唱歌 read as E minor, its first strong beat a
 * bar off). Every caller decodes at this rate for analysis; playback may use any rate.
 */
export const MEASURE_RATE=44_100;
export type {Measurement,RhythmCandidate,SoundFeatures,SoundTraits} from './measure.ts';
export {ANSWER_FIELDS,DOWNBEAT_TOLERANCE_SECONDS,TEMPO_TOLERANCE,judge,report,summarise} from './evaluate.ts';
export type {AnswerField,FieldCheck,FieldScore,JudgedRecording,MusicAnswers,Summary} from './evaluate.ts';
import type {Measurement,RhythmCandidate} from './measure.ts';
import type {MoodId} from '@wanwu-v2/contracts/arrangement';

/**
 * The program's choice of the song's characteristic rhythm: a pattern that recurs, preferring one whose notes are not
 * all the same length (an even pulse like 嗒嗒嗒嗒 fits any song, so it tells the least). Falls back to the plain beat.
 */
export function pickRhythm(candidates:readonly RhythmCandidate[],meter:number):number[]{
 let best:RhythmCandidate|null=null,bestScore=-1;
 for(const candidate of candidates){
  // An even pulse counts for less than half: it is everywhere in a recording (accompaniment), so it wins on numbers alone.
  const variety=new Set(candidate.cell).size-1;
  const score=candidate.bars*(variety?1+.6*Math.min(2,variety):.4);
  if(score>bestScore){
   bestScore=score;
   best=candidate;
  }
 }
 return best?[...best.cell]:new Array<number>(meter).fill(1);
}

/** At or above this tempo a major-key song counts as lively; below the slow mark a minor-key one counts as sad. */
const LIVELY_BPM=100,SLOW_BPM=80;
/**
 * The program's mood for a card when no model answers: major / pentatonic songs are lively when quick, else happy;
 * minor songs are sad when slow, else calm; dorian is curious.
 */
export function pickMood(measurement:Pick<Measurement,'mode'|'tempoBpm'>):MoodId{
 if(measurement.mode==='dorian')return 'curious';
 if(measurement.mode==='minor')return measurement.tempoBpm<SLOW_BPM?'sad':'calm';
 return measurement.tempoBpm>=LIVELY_BPM?'lively':'happy';
}

/** The part of the recording the audio model listens to: 30 s, skipping a short intro when the song is long enough. */
export function modelExcerpt(seconds:number,length=30){
 const start=seconds>length+12?10:Math.max(0,seconds-length)/2;
 return {start:Math.round(start*10)/10,end:Math.round(Math.min(seconds,start+length)*10)/10};
}
