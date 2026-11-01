// Plays a background plan (@wanwu-v2/sound-rules/background) with the chosen voices, offline into one buffer for the
// whole piece. It carries no musical numbers: which notes, the ending, the fades and how far it makes room under the
// child's sounds all come from the plan; who plays which part comes from assignParts. Only the timbre of the mock
// instruments lives here (a server instrument library will bring samples instead). The child's recordings are never
// touched: the buffer is its own layer.
import type {BackgroundNote,BackgroundPart,BackgroundPlan} from '@wanwu-v2/sound-rules/background';
import {ORIGINAL_PLAYER} from '@wanwu-v2/sound-rules/background';
import type {InstrumentRecipe} from './instruments.ts';

/** `original` is the background as generated: a soft, plain voice. `click` is a metronome (万物声场's beat). */
export type Voice='original'|'click'|InstrumentRecipe;

const hz=(midi:number)=>440*2**((midi-69)/12);
const SAMPLE_RATE=22050;

type OfflineConstructor=typeof OfflineAudioContext;
type Env={gain:AudioParam};
/** Held note: rises over `attack`, holds, lets go over the last 0.4 s. */
const sustain=(env:Env,at:number,end:number,peak:number,attack:number)=>{
 env.gain.setValueAtTime(0,at);
 env.gain.linearRampToValueAtTime(peak,at+Math.min(attack,(end-at)/2));
 env.gain.setValueAtTime(peak,Math.max(at+attack,end-.4));
 env.gain.linearRampToValueAtTime(0,end);
};
/** Struck note: up in 8 ms, then dies away by `end`. */
const strike=(env:Env,at:number,end:number,peak:number)=>{
 env.gain.setValueAtTime(0,at);
 env.gain.linearRampToValueAtTime(peak,at+.008);
 env.gain.exponentialRampToValueAtTime(.001,Math.max(at+.02,end));
};
/** 20 ms of white noise for the metronome's knock, made once per render (seeded, so a render is repeatable). */
const noises=new WeakMap<BaseAudioContext,AudioBuffer>();
function noise(ctx:BaseAudioContext){
 let buffer=noises.get(ctx);
 if(!buffer){
  buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.02),ctx.sampleRate);
  const data=buffer.getChannelData(0);
  let seed=7;
  for(let i=0;i<data.length;i++){
   seed=(seed*16807)%2147483647;
   data[i]=seed/1073741823.5-1;
  }
  noises.set(ctx,buffer);
 }
 return buffer;
}
/**
 * The knock's narrow band, one per output and kind of beat: every tick of a long piece shares it (a filter per tick
 * would keep hundreds of filters running to the end of the render).
 */
const bands=new WeakMap<AudioNode,{first:BiquadFilterNode;other:BiquadFilterNode}>();
function knockBand(ctx:BaseAudioContext,out:AudioNode,first:boolean){
 let pair=bands.get(out);
 if(!pair){
  const make=(hz:number)=>{
   const band=ctx.createBiquadFilter();
   band.type='bandpass';
   band.frequency.value=hz;
   band.Q.value=2.5;
   band.connect(out);
   return band;
  };
  pair={first:make(3400),other:make(2700)};
  bands.set(out,pair);
 }
 return first?pair.first:pair.other;
}
/** Louder for an accented note: 0 → ×0.7, 1 → ×1.15. */
const accented=(peak:number,note:BackgroundNote)=>peak*(.7+.45*note.accent);

/** One note in one voice. Returns false when this voice does not play this part. */
function play(ctx:BaseAudioContext,out:AudioNode,voice:Voice,note:BackgroundNote){
 const {at,length,part}=note;
 const end=at+length;
 const freq=hz(note.midi);
 // Silent until its envelope starts (a gain defaults to 1, which would let a rolled chord note blip early).
 const env=ctx.createGain();
 env.gain.value=0;
 const osc=ctx.createOscillator();
 switch(voice){
  case 'original':
   if(part==='rhythm')return false;
   osc.type='sine';
   osc.frequency.value=freq;
   // Chords struck on a textbook song's rhythm (accent > 0) are plucked so the pattern is heard; held chords stay soft.
   if(part==='chord'&&note.accent>0)strike(env,at,end,accented(.07,note));
   else if(part==='chord')sustain(env,at,end,.05,.6);
   else if(part==='bass')sustain(env,at,end,accented(.11,note),.05);
   else strike(env,at,end,accented(.11,note));
   break;
  case 'pad':
   // 风琴: everything held, reedy.
   if(part==='rhythm')return false;
   osc.type='triangle';
   osc.frequency.value=freq;
   // A chord struck on a song's rhythm (accent > 0) speaks at once; a held chord swells in.
   sustain(
    env,
    at,
    end,
    part==='chord'?.07:part==='bass'?accented(.09,note):accented(.08,note),
    part==='chord'?(note.accent?.03:.5):.04);
   break;
  case 'bells':
   // 木琴: every note struck and decaying; chords become a quick roll.
   if(part==='rhythm')return false;
   osc.type='sine';
   if(part==='chord'){
    const roll=at+(note.midi%12)*.012;
    osc.frequency.value=freq*2;
    strike(env,roll,Math.min(end,roll+.8),.06);
   }
   else{
    osc.frequency.value=part==='bass'?freq*2:freq;
    strike(env,at,end,part==='melody'?accented(.17,note):.1);
   }
   break;
  case 'pulse':
   // 小鼓: the beat, strong and weak — a deeper thump on strong beats.
   if(part!=='rhythm')return false;
   osc.type='sine';
   osc.frequency.setValueAtTime(note.accent>=.9?90:130,at);
   osc.frequency.exponentialRampToValueAtTime(45,at+.25);
   strike(env,at,Math.min(end,at+.35),.4*note.accent);
   break;
  case 'click':{
   // 节拍器: a wooden tick — a few milliseconds of struck noise through a narrow band (the knock) over a short ringing
   // body that dies within 40 ms; a bar's first beat is higher and louder, like a metronome's bell beat.
   if(part!=='rhythm')return false;
   const first=note.accent>=.9;
   const peak=.5*note.accent;
   // The ringing body.
   osc.type='sine';
   osc.frequency.setValueAtTime(first?2100:1600,at);
   osc.frequency.exponentialRampToValueAtTime(first?1900:1450,at+.04);
   env.gain.setValueAtTime(0,at);
   env.gain.linearRampToValueAtTime(peak*.7,at+.001);
   env.gain.exponentialRampToValueAtTime(.001,at+.04);
   // The knock.
   const knock=ctx.createBufferSource();
   const hit=ctx.createGain();
   knock.buffer=noise(ctx);
   hit.gain.setValueAtTime(peak*1.6,at);
   hit.gain.exponentialRampToValueAtTime(.001,at+.012);
   knock.connect(hit).connect(knockBand(ctx,out,first));
   knock.start(at);
   knock.stop(at+.02);
   osc.connect(env).connect(out);
   osc.start(at);
   osc.stop(at+.05);
   return true;
  }
 }
 osc.connect(env).connect(out);
 osc.start(at);
 osc.stop(end+.02);
 return true;
}

/**
 * Renders the plan — a background or 万物声场's beat (beatPlan) — mono, at a low sample rate (it sits underneath).
 * `parts` says which players play each part (ORIGINAL_PLAYER or an instrument id) and `voices` how each instrument id
 * sounds.
 */
export async function renderBackground(
 plan:Pick<BackgroundPlan,'seconds'|'fadeInSeconds'|'fadeOutSeconds'|'duck'|'notes'>,
 parts:Record<BackgroundPart,string[]>,
 voices:Readonly<Record<string,Voice>>,
):Promise<AudioBuffer>{
 const {seconds}=plan;
 const Offline=window.OfflineAudioContext
  ||(window as unknown as {webkitOfflineAudioContext:OfflineConstructor}).webkitOfflineAudioContext;
 const voiceOf=(player:string):Voice=>player===ORIGINAL_PLAYER?'original':voices[player]??'original';
 const players=Object.values(parts).flat();
 // Only metronome ticks and nothing to make room for: the quick path.
 if(players.length
  &&players.every(player=>voiceOf(player)==='click')
  &&plan.duck.every(point=>point.gain===1))return stampTicks(Offline,plan,parts.rhythm.length);
 const ctx=new Offline(1,Math.max(1,Math.ceil(seconds*SAMPLE_RATE)),SAMPLE_RATE);
 // Fade in and out over the whole piece, then make room under the child's sounds (the plan's duck points).
 const fade=ctx.createGain();
 const duck=ctx.createGain();
 fade.gain.setValueAtTime(0,0);
 fade.gain.linearRampToValueAtTime(1,plan.fadeInSeconds);
 fade.gain.setValueAtTime(1,seconds-plan.fadeOutSeconds);
 fade.gain.linearRampToValueAtTime(0,seconds);
 duck.gain.setValueAtTime(plan.duck[0]?.gain??1,0);
 for(const point of plan.duck.slice(1))duck.gain.linearRampToValueAtTime(point.gain,point.at);
 // Brighter tone when bells or a metronome play.
 const bright=Object.values(parts)
  .some(players=>players.some(player=>voiceOf(player)==='bells'||voiceOf(player)==='click'));
 const tone=ctx.createBiquadFilter();
 tone.type='lowpass';
 tone.frequency.value=bright?5200:2400;
 fade.connect(duck).connect(tone).connect(ctx.destination);
 for(const [part,players] of Object.entries(parts) as [BackgroundPart,string[]][]){
  if(!players.length)continue;
  // Several players on one part: keep the part about as loud as one.
  const level=ctx.createGain();
  level.gain.value=1/Math.sqrt(players.length);
  level.connect(fade);
  for(const player of players)for(const note of plan.notes)
   if(note.part===part)play(ctx,level,voiceOf(player),note);
 }
 return ctx.startRendering();
}

/** Long enough for one metronome tick and its filter to die away. */
const TICK_SECONDS=.06;
/**
 * Only metronome ticks (万物声场's beat, 听原曲 over a whole song): every tick of one strength is the same few
 * milliseconds, so each is rendered once through the same chain (part level, bright tone) and copied to its places,
 * then the piece's fades are applied — the same sound as rendering them all, in milliseconds instead of a graph that
 * keeps a few nodes per tick running for the whole length. Plans that make room under the child's sounds (duck) never
 * come here.
 */
async function stampTicks(
 Offline:OfflineConstructor,
 plan:Pick<BackgroundPlan,'seconds'|'fadeInSeconds'|'fadeOutSeconds'|'notes'>,
 players:number,
):Promise<AudioBuffer>{
 const length=Math.max(1,Math.ceil(plan.seconds*SAMPLE_RATE));
 const out=new Offline(1,length,SAMPLE_RATE).createBuffer(1,length,SAMPLE_RATE);
 const data=out.getChannelData(0);
 const notes=plan.notes.filter(note=>note.part==='rhythm');
 /** One rendered tick per accent, shared by every tick of that strength. */
 const ticks=new Map<number,Promise<Float32Array>>();
 const tick=(accent:number)=>{
  let made=ticks.get(accent);
  if(!made){
   const ctx=new Offline(1,Math.ceil(TICK_SECONDS*SAMPLE_RATE),SAMPLE_RATE);
   const level=ctx.createGain();
   const tone=ctx.createBiquadFilter();
   level.gain.value=1/Math.sqrt(players);
   tone.type='lowpass';
   tone.frequency.value=5200;
   level.connect(tone).connect(ctx.destination);
   for(let i=0;i<players;i++)play(ctx,level,'click',{at:0,length:TICK_SECONDS,midi:0,part:'rhythm',accent});
   made=ctx.startRendering().then(buffer=>buffer.getChannelData(0));
   ticks.set(accent,made);
  }
  return made;
 };
 for(const note of notes){
  const sound=await tick(note.accent);
  const start=Math.round(note.at*SAMPLE_RATE);
  for(let i=0;i<sound.length&&start+i<length;i++)data[start+i]=data[start+i]!+sound[i]!;
 }
 // The fades, as the full render's fade gain: up over fadeInSeconds, down over the last fadeOutSeconds.
 const fadeIn=plan.fadeInSeconds*SAMPLE_RATE;
 const fadeOutFrom=(plan.seconds-plan.fadeOutSeconds)*SAMPLE_RATE;
 const fadeOut=plan.fadeOutSeconds*SAMPLE_RATE;
 for(let i=0;i<length;i++){
  let gain=1;
  if(i<fadeIn)gain=i/fadeIn;
  if(fadeOut>0&&i>fadeOutFrom)gain=Math.min(gain,Math.max(0,1-(i-fadeOutFrom)/fadeOut));
  if(gain!==1)data[i]=data[i]!*gain;
 }
 return out;
}
