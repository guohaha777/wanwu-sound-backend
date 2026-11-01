import test from 'node:test';
import assert from 'node:assert/strict';
import {ORIGINAL_PLAYER,assignParts,backgroundMeeting,backgroundPlan,beatPlan} from '../src/background.ts';
import type {BackgroundInput} from '../src/background.ts';
import {duckPoints,mergeSpans} from '../src/mix.ts';
import {BACKGROUND_RULES,MIX_RULES,backgroundProblems,mixProblems} from '../src/rules.ts';

const input=(extra:Partial<BackgroundInput>={}):BackgroundInput=>({seconds:30,sounding:[{start:2,end:6},{start:10,end:12},{start:20,end:27}],mood:null,textbook:null,seed:'work:1',...extra});
const lullaby={id:'tb:mock:lullaby',tempoBpm:66,meter:3 as const,rhythmCell:[2,1],mode:'major' as const,mood:'calm' as const};

test('the background and mix rule files load and pass their checks',()=>{
 assert.deepEqual(backgroundProblems(BACKGROUND_RULES),[]);
 assert.deepEqual(mixProblems(MIX_RULES),[]);
 const broken=structuredClone(BACKGROUND_RULES);
 broken.modes.minor.scale=[0,2,3,5,7,8];
 assert.match(backgroundProblems(broken).join('\n'),/background\.modes\.minor\.scale 应该是 7–7 个数字的列表/);
 const word=structuredClone(BACKGROUND_RULES);
 (word.moods.sad as {mode:string}).mode='sadder';
 assert.match(backgroundProblems(word).join('\n'),/background\.moods\.sad\.mode = "sadder"，只能是 major \/ minor \/ pentatonic \/ dorian/);
});

test('the same work always gets the same background; another work gets another melody',()=>{
 assert.deepEqual(backgroundPlan(input()),backgroundPlan(input()));
 const melody=(seed:string)=>backgroundPlan(input({seed})).notes.filter(note=>note.part==='melody').map(note=>note.midi);
 assert.notDeepEqual(melody('work:1'),melody('work:2'));
});

test('the mood colours the background: sad is minor and slower, lively is quicker; the textbook lends its rhythm',()=>{
 const plain=backgroundPlan(input()),sad=backgroundPlan(input({mood:'sad'})),lively=backgroundPlan(input({mood:'lively'}));
 assert.equal(plain.mode,'major');
 assert.equal(sad.mode,'minor');
 assert.equal(sad.colour,'sad');
 assert.ok(sad.tempo<plain.tempo&&lively.tempo>plain.tempo);
 const borrowed=backgroundPlan(input({textbook:lullaby}));
 assert.deepEqual([borrowed.tempo,borrowed.metre,borrowed.colour,borrowed.textbook],[66,3,'calm','tb:mock:lullaby'],'no mood: the song gives rhythm and colour');
 const both=backgroundPlan(input({textbook:lullaby,mood:'sad'}));
 assert.deepEqual([both.tempo,both.metre,both.mode,both.colour],[66,3,'minor','sad'],'the child\'s mood decides the colour, the song the rhythm');
 // The melody follows the song's rhythm cell: long, short, long, short…
 const melody=borrowed.notes.filter(note=>note.part==='melody'),beat=60/66;
 for(const note of melody.slice(0,-1))assert.ok([2,1].some(beats=>Math.abs(note.length-beats*beat*BACKGROUND_RULES.melody.noteLengthPortion)<1e-9));
});

test('the melody only plays in the gaps between the child\'s sounds',()=>{
 const plan=backgroundPlan(input()),{marginSeconds}=BACKGROUND_RULES.melody;
 const melody=plan.notes.filter(note=>note.part==='melody');
 assert.ok(melody.length>0);
 for(const note of melody)for(const sound of input().sounding)
  assert.ok(note.at+note.length<=sound.start-marginSeconds+1e-9||note.at>=sound.end+marginSeconds-1e-9,`${note.at} overlaps ${sound.start}–${sound.end}`);
 const filled=backgroundPlan(input({sounding:[{start:0,end:30}]}));
 assert.equal(filled.notes.filter(note=>note.part==='melody').length,0,'no gap, no melody');
 assert.ok(filled.notes.some(note=>note.part==='chord'),'chords and bass stay under the child\'s sounds');
});

test('the ending stays inside the piece: dominant, then the tonic on a bar line with room to ring',()=>{
 for(const seconds of [20,22.4,30,45,47.3])for(const mood of [null,'sad','lively','curious'] as const){
  const plan=backgroundPlan(input({seconds,mood})),bar=60/plan.tempo*plan.metre;
  assert.ok(Math.abs(plan.cadenceAt/bar-Math.round(plan.cadenceAt/bar))<1e-9,'on a bar line');
  assert.ok(seconds-plan.cadenceAt>=BACKGROUND_RULES.ending.minRingSeconds-1e-9&&seconds-plan.cadenceAt<bar+BACKGROUND_RULES.ending.minRingSeconds+1e-9);
  assert.ok(plan.notes.every(note=>note.at+note.length<=seconds+1e-9),'never longer than the piece');
  const scale=BACKGROUND_RULES.modes[plan.mode].scale,feel=BACKGROUND_RULES.moods[plan.colour];
  const last=plan.notes.filter(note=>note.part==='chord'&&Math.abs(note.at-plan.cadenceAt)<1e-9).map(note=>note.midi);
  assert.deepEqual(last,[feel.tonic,feel.tonic+scale[2]!,feel.tonic+scale[4]!],'the last chord is the tonic');
  assert.ok(plan.notes.filter(note=>note.part==='chord'&&Math.abs(note.at-plan.cadenceAt)<1e-9).every(note=>Math.abs(note.at+note.length-seconds)<1e-9),'and holds to the end');
  const before=plan.notes.filter(note=>note.part==='chord'&&Math.abs(note.at-(plan.cadenceAt-bar))<1e-9).map(note=>note.midi);
  if(plan.cadenceAt>=2*bar)assert.equal(((before[0]!-(feel.tonic+scale[4]!))%12+12)%12,0,'the bar before is the dominant');
 }
});

test('背景让一让: down by the rule\'s depth while the child\'s sounds play, back up after',()=>{
 const points=duckPoints([{start:2,end:6},{start:6.2,end:7}],30),low=10**(-MIX_RULES.duck.depthDb/20);
 assert.deepEqual(mergeSpans([{start:2,end:6},{start:6.2,end:7}],30,.48),[{start:2,end:7}],'close sounds count as one');
 assert.equal(points.find(point=>point.at===2)!.gain,low);
 assert.equal(points.at(-1)!.gain,1);
 assert.ok(Math.abs(points.at(-1)!.at-(7+MIX_RULES.duck.releaseSeconds))<1e-9);
 assert.ok(points.every((point,i)=>i===0||point.at>=points[i-1]!.at),'in time order');
});

test('who plays which part: lead first, then whoever can; pitched parts nobody can play keep the original voice',()=>{
 const organ={id:'organ',lead:['chord','bass'] as const,can:['melody'] as const},xylophone={id:'xylophone',lead:['melody'] as const,can:['chord','bass'] as const},drum={id:'drum',lead:['rhythm'] as const,can:[] as const};
 assert.deepEqual(assignParts([]),{chord:[ORIGINAL_PLAYER],bass:[ORIGINAL_PLAYER],melody:[ORIGINAL_PLAYER],rhythm:[]},'nothing chosen: as generated');
 assert.deepEqual(assignParts([drum]),{chord:[ORIGINAL_PLAYER],bass:[ORIGINAL_PLAYER],melody:[ORIGINAL_PLAYER],rhythm:['drum']},'a drum alone joins the original');
 assert.deepEqual(assignParts([organ]),{chord:['organ'],bass:['organ'],melody:['organ'],rhythm:[]});
 assert.deepEqual(assignParts([organ,xylophone,drum]),{chord:['organ'],bass:['organ'],melody:['xylophone'],rhythm:['drum']},'each does its own job');
});

test('碰一碰: together on the beat, call and answer between sounds, filling the gaps, or carrying them',()=>{
 const beat=60/76;
 const onBeats=[0,4,8,12].map(b=>({start:b*beat,end:b*beat+.5}));
 assert.equal(backgroundMeeting(backgroundPlan(input({sounding:onBeats})),onBeats).kind,'together');
 const offBeat=[{start:.4,end:3},{start:6.3,end:9},{start:12.3,end:15},{start:18.3,end:21}];
 assert.equal(backgroundMeeting(backgroundPlan(input({sounding:offBeat})),offBeat).kind,'answer');
 const once=[{start:.4,end:3}];
 assert.equal(backgroundMeeting(backgroundPlan(input({sounding:once})),once).kind,'fill');
 const wall=[{start:.4,end:30}];
 assert.equal(backgroundMeeting(backgroundPlan(input({sounding:wall})),wall).kind,'under');
});

test('a chosen song is heard in every layer: chords and drum play its rhythm, the bass its on-beat notes, the key is the song\'s',()=>{
 const song={...lullaby,rhythmCell:[.75,.25,1],meter:2 as const,tempoBpm:120,tonic:5};
 const plan=backgroundPlan(input({textbook:song,mood:'lively'})),beat=.5;
 const before=plan.notes.filter(note=>note.at<plan.cadenceAt-1e-9);
 const drumAts=before.filter(note=>note.part==='rhythm').map(note=>Math.round(note.at/beat*4)/4%2);
 assert.ok(drumAts.every(at=>[0,.75,1].includes(at)),'the drum plays 0, ¾ and 1 of every bar');
 assert.ok(drumAts.includes(.75),'including the off-beat note');
 const chordAts=new Set(before.filter(note=>note.part==='chord').map(note=>Math.round(note.at/beat*4)/4%2));
 assert.deepEqual([...chordAts].sort(),[0,.75,1],'chords are struck on the song\'s rhythm');
 assert.ok(before.filter(note=>note.part==='bass').every(note=>Number.isInteger(Math.round(note.at/beat*1e6)/1e6)),'bass only on beats');
 assert.equal(((plan.tonic%12)+12)%12,5,'key centre F, the song\'s');
 assert.equal(plan.mode,'major','lively stays major');
 assert.ok(Math.abs(plan.tonic-BACKGROUND_RULES.moods.lively.tonic)<=6,'in the mood\'s register');
 const off=backgroundPlan(input({textbook:song,mood:'lively'}),{...BACKGROUND_RULES,song:{...BACKGROUND_RULES.song,chordsFollow:0,drumsFollow:0,bassFollow:0,keyFollow:0}});
 assert.equal(off.tonic,BACKGROUND_RULES.moods.lively.tonic);
 assert.ok(off.notes.filter(note=>note.part==='rhythm'&&note.at<off.cadenceAt).every(note=>Number.isInteger(Math.round(note.at/beat*1e6)/1e6)),'switched off: even beats again');
});

test('the melody answers the child\'s sounds: away from their register, along their contour, as strong as they were',()=>{
 const spans=input().sounding;
 const as=(fields:object)=>backgroundPlan(input({sounding:spans.map(span=>({...span,...fields}))})).notes.filter(note=>note.part==='melody');
 const mean=(notes:{midi:number}[])=>notes.reduce((sum,note)=>sum+note.midi,0)/notes.length;
 assert.ok(mean(as({pitch:'high'}))<mean(as({}))&&mean(as({pitch:'low'}))>mean(as({})),'higher sounds → lower melody, lower sounds → higher');
 // The gap after the second sound (12 s → 20 s): its phrase follows the contour of the sound just heard.
 const inGap=(notes:{at:number;midi:number}[])=>notes.filter(note=>note.at>=12&&note.at<19.5).map(note=>note.midi);
 const rising=inGap(as({contour:'rising'})),falling=inGap(as({contour:'falling'}));
 assert.ok(rising.length>=3&&falling.length>=3);
 assert.ok(rising.at(-1)!>rising[0]!,`rising answer goes up: ${rising}`);
 assert.ok(falling.at(-1)!<falling[0]!,`falling answer goes down: ${falling}`);
 const accent=(notes:{accent:number}[])=>notes.reduce((sum,note)=>sum+note.accent,0)/notes.length;
 assert.ok(accent(as({intensity:'loud'}))>accent(as({intensity:'soft'})));
 const off={...BACKGROUND_RULES,answer:{...BACKGROUND_RULES.answer,registerShiftSemitones:0,followContour:0,intensityAccent:0}};
 assert.deepEqual(backgroundPlan(input({sounding:spans.map(span=>({...span,pitch:'high',contour:'rising',intensity:'loud'}))}),off).notes,backgroundPlan(input(),off).notes,'switched off: the child\'s choices change nothing');
});

test('万物声场\'s beat: every beat of the song\'s tempo, strong on each bar\'s first, nothing but the drum part, steady under the sounds',()=>{
 const plan=beatPlan({seconds:10,tempo:90,metre:3}),beat=60/90;
 assert.equal(plan.notes.length,Math.ceil(10/beat-1e-9));
 assert.ok(plan.notes.every((note,i)=>Math.abs(note.at-i*beat)<1e-9&&note.part==='rhythm'&&note.at+note.length<=10+1e-9));
 assert.deepEqual(plan.notes.slice(0,4).map(note=>note.accent),[BACKGROUND_RULES.beat.strong,BACKGROUND_RULES.beat.weak,BACKGROUND_RULES.beat.weak,BACKGROUND_RULES.beat.strong]);
 assert.deepEqual(plan.duck,[]);
 assert.equal(plan.fadeInSeconds,0);
 const louder=structuredClone(BACKGROUND_RULES);
 louder.beat.strong=.3;
 louder.beat.weak=.5;
 assert.match(backgroundProblems(louder).join('\n'),/background\.beat\.weak 不能比 strong 还响/);
});
