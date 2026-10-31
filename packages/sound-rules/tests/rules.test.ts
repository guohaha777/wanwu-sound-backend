import test from 'node:test';
import assert from 'node:assert/strict';
import {ANALYSIS_RULES,MUSIC_TYPES_RULES,SHAPING_RULES,analysisProblems,musicTypesProblems,shapingProblems} from '../src/rules.ts';

test('the rule files load and pass every range and relation check',()=>{
 assert.deepEqual(analysisProblems(ANALYSIS_RULES),[]);
 assert.deepEqual(shapingProblems(SHAPING_RULES),[]);
 assert.deepEqual(musicTypesProblems(MUSIC_TYPES_RULES),[]);
});

test('a bad edit is reported in plain words, naming the parameter',()=>{
 const tooLoud=structuredClone(SHAPING_RULES);tooLoud.level.choiceDb.loud=6;
 assert.match(shapingProblems(tooLoud).join('\n'),/shaping\.level\.choiceDb\.loud = 6，超出允许范围/);
 const flipped=structuredClone(SHAPING_RULES);flipped.duration.minStretch=1;
 assert.match(shapingProblems(flipped).join('\n'),/minStretch 要小于 1/);
 const typo={...structuredClone(ANALYSIS_RULES),frameSecond:.02} as unknown as typeof ANALYSIS_RULES;
 assert.match(analysisProblems(typo).join('\n'),/analysis\.frameSecond 不认识/);
 const missing=structuredClone(ANALYSIS_RULES) as Partial<typeof ANALYSIS_RULES>;delete missing.kind;
 assert.match(analysisProblems(missing as typeof ANALYSIS_RULES).join('\n'),/analysis\.kind 缺少/);
});

test('music types: a path that claims no tempo cannot follow a beat cue or mark strong beats; free rhythm claims none',()=>{
 const bad=structuredClone(MUSIC_TYPES_RULES);bad.paths.free.beatCue='bass';bad.paths.free.strongBeat=true;
 const problems=musicTypesProblems(bad).join('\n');
 assert.match(problems,/不测速度/);
 const timed=structuredClone(MUSIC_TYPES_RULES);timed.paths.free.tempo=true;
 assert.match(musicTypesProblems(timed).join('\n'),/节奏自由的录音不能测速度/);
 const typo=structuredClone(MUSIC_TYPES_RULES);(typo.paths.solo as {tempo:unknown}).tempo='yes';
 assert.match(musicTypesProblems(typo).join('\n'),/musicTypes\.paths\.solo\.tempo = "yes"，只能是 true \/ false/);
});
