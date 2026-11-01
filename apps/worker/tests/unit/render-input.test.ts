import test from 'node:test';
import assert from 'node:assert/strict';
import {workRenderInput} from '../../src/jobs/renderInput.ts';
import {prototypeInput} from '../../src/prototype-fixtures.ts';
import {textbookTrack} from '../../../api/src/catalogue.ts';
import type {TextbookSnapshot} from '@wanwu-v2/contracts/textbook-compose';
import {isTextbookSnapshot} from '@wanwu-v2/contracts/textbook-compose';
import {RULE_VERSIONS} from '@wanwu-v2/sound-rules/rules';
test('worker forwards the finished textbook music and uploaded feature snapshot without a new catalogue lookup',()=>{
 const fixture=prototypeInput(),track={...textbookTrack('tb:ry1:u2:birds-singing')!,id:'teaching:private'};
 const textbook:TextbookSnapshot={version:'textbook-snapshot-v1',identity:'textbook:0000000000000001',inputToken:'ai:0000000000000001',mood:null,track,references:[],
  music:{rules:'textbook-compose-v1',mix:RULE_VERSIONS.mix,source:'local-rules',seconds:20,tempo:96,metre:2,mode:'major',tonic:60,cadenceAt:18.75,textbook:track.id,colour:'lively',fadeInSeconds:.03,fadeOutSeconds:.8,duck:[],notes:[{at:0,length:1,midi:60,part:'melody',accent:.5}]}};
 assert.ok(isTextbookSnapshot(textbook));
 const settings={...fixture.settings,inspiration:{kind:'teaching-music' as const,musicId:track.id,name:'本机歌曲',durationMs:30000}};
 const content={id:fixture.arrangement.id,title:'课本',arrangement:fixture.arrangement,settings,rendering:{background:'local-rules' as const,prompt:null,rules:{...RULE_VERSIONS},textbook}};
 const output=workRenderInput(content,RULE_VERSIONS);assert.equal(output.textbookBackground,textbook);assert.equal(output.textbook,track);
 assert.deepEqual(output.textbookBackground!.music.notes,textbook.music.notes);
});
test('legacy AI composed notes remain forwarded and legacy catalogue cards still resolve',()=>{
 const fixture=prototypeInput(),composed={tempo:100,metre:4 as const,mode:'major' as const,tonic:60,cadenceAt:18,notes:[{at:0,length:1,midi:60,part:'melody' as const,accent:.5}]};
 const content={id:fixture.arrangement.id,title:'旧作品',arrangement:fixture.arrangement,settings:fixture.settings,rendering:{background:'program' as const,prompt:null,rules:{...RULE_VERSIONS},composed}};
 assert.equal(workRenderInput(content,RULE_VERSIONS).composed,composed);
 assert.ok(textbookTrack('tb:ry1:u2:birds-singing'));assert.ok(textbookTrack('tb:ry1:u7:french-horn'));assert.ok(textbookTrack('tb:mock:march'));
});
