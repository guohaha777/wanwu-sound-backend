// AI background composition (ai-compose-v1): one test per mapping from the child's piece to the music.
import test from 'node:test';
import assert from 'node:assert/strict';
import type {BackgroundBrief,BriefSound,ComposePlan} from '@wanwu-v2/contracts/background';
import {isComposePlan} from '@wanwu-v2/contracts/background';
import {AI_COMPOSE_RULES,aiComposeProblems,briefSound,changedCount,composeNotes,fitPlan,portrait,programBackground,programPlan,ranges} from '../src/aiCompose.ts';
import type {AiComposeRules} from '../src/aiCompose.ts';
import {BACKGROUND_RULES} from '../src/rules.ts';

const sound=(n:number,start:number,end:number,extra:Partial<BriefSound>={}):BriefSound=>({
 n,start,end,pitch:'mid',length:'medium',contour:null,intensity:'medium',pattern:'once',kind:'one',brightness:'mid',...extra,
});
const brief=(extra:Partial<BackgroundBrief>={}):BackgroundBrief=>({
 version:'background-request-v2',workId:'work:test',seconds:30,mood:null,
 sounds:[sound(1,2,4),sound(2,9,11),sound(1,20,22)],attempt:0,previous:null,instruments:[],
 rules:{analysis:'a',shaping:'s',background:'b',mix:'m'},...extra,
});

test('the rule file loads, and a bad value is reported in plain words',()=>{
 assert.deepEqual(aiComposeProblems(AI_COMPOSE_RULES),[]);
 const bad={...AI_COMPOSE_RULES,moods:{...AI_COMPOSE_RULES.moods,calm:{...AI_COMPOSE_RULES.moods.calm,drums:['disco']}}} as AiComposeRules;
 assert.match(aiComposeProblems(bad).join(),/moods\.calm\.drums 有不认识的鼓/);
});

test('each sound: the child\'s choice first, then the 声音体检, then the middle',()=>{
 const measured={band:'high' as const,lengthBand:'short' as const,loudnessDb:-40,brightnessHz:5000,kind:'series' as const};
 assert.deepEqual(briefSound(1,0,1,{pitch:'low'},measured),
  {n:1,start:0,end:1,pitch:'low',length:'short',contour:null,intensity:'soft',pattern:'once',kind:'series',brightness:'bright'});
 assert.deepEqual(briefSound(2,0,1,{},undefined),
  {n:2,start:0,end:1,pitch:'mid',length:'medium',contour:null,intensity:'medium',pattern:'once',kind:'one',brightness:'mid'});
});

test('portrait: density from sounds per bar and coverage; what most sounds are; full quarters',()=>{
 const sparse=portrait(brief());
 assert.equal(sparse.density,'sparse');
 assert.equal(sparse.kinds,2);
 const busy=portrait(brief({sounds:Array.from({length:12},(_,i)=>sound(1,i*2.5,i*2.5+2,{pitch:'high',contour:'rising',intensity:'loud'}))}));
 assert.equal(busy.density,'busy');
 assert.equal(busy.register,'high');
 assert.equal(busy.contour,'rising');
 assert.equal(busy.intensity,'loud');
 const early=portrait(brief({sounds:[sound(1,1,2),sound(1,3,4),sound(2,5,6),sound(2,25,26)]}));
 assert.deepEqual(early.sections.map(section=>section.full),[true,false,false,false]);
});

test('tempo: around the mood\'s, faster for a busy piece or short sounds, slower for a sparse one or long sounds',()=>{
 const calm=AI_COMPOSE_RULES.moods.calm.tempo,{shift,span}=AI_COMPOSE_RULES.tempo;
 const slow=ranges(portrait(brief({mood:'calm'})));
 assert.deepEqual(slow.tempo,[Math.max(AI_COMPOSE_RULES.tempo.min,calm-shift-span),calm-shift+span]);
 const quick=ranges(portrait(brief({mood:'happy',sounds:Array.from({length:12},(_,i)=>sound(1,i*2.5,i*2.5+2,{length:'short'}))})));
 const happy=AI_COMPOSE_RULES.moods.happy.tempo;
 assert.deepEqual(quick.tempo,[happy+shift-span,happy+shift+span]);
});

test('mood sets metres, modes, chords, bass and drums; quiet moods get no groove',()=>{
 const calm=ranges(portrait(brief({mood:'calm'})));
 assert.deepEqual(calm.metres,[3,4]);
 assert.ok(calm.drums.every(drums=>['none','heartbeat'].includes(drums)));
 assert.ok(calm.bass.every(bass=>['none','hold'].includes(bass)));
 const happy=ranges(portrait(brief({mood:'happy'})));
 assert.ok(happy.modes.every(mode=>['major','pentatonic'].includes(mode)));
});

test('without a mood, bright sounds lean to the major modes and dark ones to the minor',()=>{
 const bright=ranges(portrait(brief({sounds:[sound(1,1,2,{brightness:'bright'})]})));
 const dark=ranges(portrait(brief({sounds:[sound(1,1,2,{brightness:'dark'})]})));
 assert.equal(bright.modes[0],'major');
 assert.equal(dark.modes[0],'minor');
});

test('accompaniment follows how the sounds appear, their kind and length; loudness chooses the bass',()=>{
 assert.ok(ranges(portrait(brief({sounds:[sound(1,1,2,{pattern:'repeat'})]}))).patterns.includes('ostinato'));
 assert.ok(ranges(portrait(brief({sounds:[sound(1,1,2,{pattern:'bursts'})]}))).patterns.includes('offbeat'));
 const wind=ranges(portrait(brief({mood:'happy',sounds:[sound(1,1,9,{kind:'texture'}),sound(1,12,20,{kind:'texture'})]})));
 assert.ok(wind.patterns.includes('pad'),'sounds that run together get a pad');
 assert.deepEqual(wind.drums,['none'],'no beat under the wind (happy has no quiet drums)');
 const loud=ranges(portrait(brief({sounds:[sound(1,1,2,{intensity:'loud'})]})));
 assert.ok(loud.bass.every(bass=>['pulse','walk','ostinato'].includes(bass)));
 assert.deepEqual(ranges(portrait(brief({sounds:[sound(1,1,2,{length:'long'})]}))).beats,AI_COMPOSE_RULES.motif.beats.long);
});

test('the program\'s plan: inside the ranges, the same for the same try, different for the next',()=>{
 const piece=brief({mood:'curious'});
 const plan=programPlan(piece);
 assert.ok(isComposePlan(plan));
 const range=ranges(portrait(piece));
 assert.ok(plan.tempo>=range.tempo[0]&&plan.tempo<=range.tempo[1]);
 assert.ok(range.metres.includes(plan.metre)&&range.modes.includes(plan.mode)&&range.patterns.includes(plan.pattern));
 assert.deepEqual(programPlan(piece),plan,'repeatable');
 // Five 换一首 in a row: each differs from the one before in at least the minimum number of choices.
 let previous:ComposePlan=plan;
 for(let attempt=1;attempt<=5;attempt++){
  const next=programPlan({...piece,attempt,previous});
  assert.ok(changedCount(next,previous)>=AI_COMPOSE_RULES.variety.minChanged,`try ${attempt}`);
  assert.notDeepEqual(next.motif,previous.motif);
  previous=next;
 }
});

test('a model\'s plan: kept inside the ranges, full quarters kept quiet, the register moves, too-similar gets changed',()=>{
 const piece=brief({mood:'calm',sounds:[sound(1,1,2),sound(1,3,4),sound(2,5,6),sound(2,25,26)]});
 const reference=programPlan(piece);
 const loudStart={...reference,sections:[{density:'busy',register:'mid',dynamics:'loud'},{density:'medium',register:'mid',dynamics:'medium'},
  {density:'medium',register:'mid',dynamics:'medium'},{density:'medium',register:'mid',dynamics:'medium'}]};
 const fitted=fitPlan(loudStart,piece)!;
 assert.deepEqual(fitted.plan.sections[0],{density:'sparse',register:'mid',dynamics:'soft'});
 assert.ok(new Set(fitted.plan.sections.map(section=>section.register)).size>1);
 assert.match(fitted.repairs.join(),/第 1 段孩子的声音多/);
 const again=fitPlan(reference,{...piece,attempt:1,previous:reference})!;
 assert.ok(changedCount(again.plan,reference)>=AI_COMPOSE_RULES.variety.minChanged);
 assert.match(again.repairs.join(),/和上一首太像/);
 assert.equal(fitPlan('a melody',piece),null);
});

test('the notes: all four parts, inside the piece, the melody only in the gaps, the same plan the same notes',()=>{
 const piece=brief({mood:'happy'});
 const plan:ComposePlan={...programPlan(piece),pattern:'arpeggio',bass:'walk',drums:'march',metre:4};
 const {notes,cadenceAt}=composeNotes(piece,plan);
 assert.deepEqual(new Set(notes.map(note=>note.part)),new Set(['chord','bass','rhythm','melody']));
 assert.ok(notes.every(note=>note.at>=0&&note.at+note.length<=piece.seconds+1e-6));
 const margin=BACKGROUND_RULES.melody.marginSeconds;
 for(const note of notes.filter(item=>item.part==='melody'&&item.at<cadenceAt))
  for(const child of piece.sounds)
   assert.ok(note.at+note.length<=child.start-margin+1e-6||note.at>=child.end+margin-1e-6,`melody at ${note.at} meets a sound`);
 assert.deepEqual(composeNotes(piece,plan).notes,notes);
 assert.equal(composeNotes(piece,{...plan,drums:'none'}).notes.filter(note=>note.part==='rhythm').length,0);
 assert.equal(composeNotes(piece,{...plan,bass:'none'}).notes.filter(note=>note.part==='bass').length,0);
});

test('the melody answers the sound before each gap: 对答 moves away from a high sound, 模仿 stays',()=>{
 const piece=brief({sounds:[sound(1,0,2,{pitch:'high',contour:'rising'})],seconds:20});
 const base=programPlan(piece);
 const plan={...base,motif:{degrees:[0,2,4],beats:[1,1,2]},sections:base.sections.map(section=>({...section,register:'mid' as const}))};
 const melody=(answer:'imitate'|'mirror')=>composeNotes(piece,{...plan,answer}).notes.filter(note=>note.part==='melody').slice(0,3);
 const mirror=melody('mirror'),imitate=melody('imitate');
 assert.ok(mirror[0]!.midi<imitate[0]!.midi,'对答 answers a high sound lower');
 assert.ok(imitate[2]!.midi>imitate[0]!.midi,'模仿 follows a rising sound upwards');
 assert.ok(mirror[2]!.midi<mirror[0]!.midi,'对答 answers a rising sound downwards');
});

test('降级：程序自编 gives a complete background with no model',()=>{
 const made=programBackground(brief({mood:'sad'}));
 assert.ok(isComposePlan(made.plan));
 assert.ok(made.notes.length>20);
});

test('first references follow ordered sound data, not the work id or coarse portrait alone',()=>{
 const piece=brief();
 const base=programPlan(piece);
 assert.deepEqual(programPlan({...piece,workId:'work:another-id'}),base,'new work id alone changes no music');
 const shifted={...piece,sounds:piece.sounds.map(sound=>({...sound,start:sound.start+.2,end:sound.end+.2}))};
 assert.deepEqual(portrait(shifted),portrait(piece),'the coarse portrait is unchanged');
 assert.notDeepEqual(programPlan(shifted),base,'exact timing changes the reference');
 const ordered={...piece,sounds:piece.sounds.map((sound,i)=>({...sound,pitch:i===0?'high' as const:'low' as const}))};
 // Swap two unlike sounds while preserving all start/end times and feature totals.
 const reversed={...ordered,sounds:[{...ordered.sounds[0]!,pitch:'low' as const},ordered.sounds[1]!,{...ordered.sounds[2]!,pitch:'high' as const}]};
 assert.deepEqual(portrait(ordered),portrait(reversed));
 assert.notDeepEqual(programPlan(ordered),programPlan(reversed));
 assert.notDeepEqual(programPlan({...piece,identity:'ai:0000000000000001'}),programPlan({...piece,identity:'ai:0000000000000002'}));
});

test('AI motif degrees use the chosen seven-note mode or five-note pentatonic, including negative degrees',()=>{
 const piece=brief({seconds:30,sounds:[sound(1,25,26)]});
 const scales={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],dorian:[0,2,3,5,7,9,10],pentatonic:[0,2,4,7,9]};
 for(const [mode,scale] of Object.entries(scales)){
  const degrees=[-1,0,1,3,5,7];
  const plan:ComposePlan={...programPlan(piece),mode:mode as ComposePlan['mode'],tempo:120,tonicShift:0,
   motif:{degrees,beats:degrees.map(()=>.5)},answer:'imitate',
   sections:Array.from({length:4},()=>({density:'busy',register:'mid',dynamics:'medium'}))};
  const melody=composeNotes(piece,plan).notes.filter(note=>note.part==='melody').slice(0,degrees.length);
  const tonic=BACKGROUND_RULES.moods.none.tonic+BACKGROUND_RULES.melody.liftSemitones;
  assert.deepEqual(melody.map(note=>note.midi),degrees.map(degree=>tonic+scale[((degree%scale.length)+scale.length)%scale.length]!+12*Math.floor(degree/scale.length)),mode);
 }
});
