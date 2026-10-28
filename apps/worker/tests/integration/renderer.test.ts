import test,{afterEach,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Browser} from 'playwright';
import {developmentTools} from '../../src/devTools.ts';
import {normalizeSource,encodeMp3,sha256} from '../../src/media/normalize.ts';
import type {NormalizedSource} from '../../src/media/normalize.ts';
import {browserBundle,openRenderer,renderInBrowser} from '../../src/browser/runner.ts';
import {prototypeInput,writePrototypeSources} from '../../src/prototype-fixtures.ts';
import {readPcm16Wave,pcmMetrics} from '@wanwu-v2/audio-engine/pcm';
import {analyseSamples} from '@wanwu-v2/sound-rules/analysis';

let browser:Browser,bundle:string;
// Match production's one fresh Chromium per job, not one browser accumulating
// several unrelated works and parity fixtures inside the same memory budget.
beforeEach(async()=>{const runtime=await openRenderer();browser=runtime.browser;bundle=await browserBundle();});
afterEach(async()=>{await browser?.close();});

test('shared shaping and timbres match frozen reference within float32 rounding noise',{timeout:120_000},async t=>{
 const entry=fileURLToPath(new URL('../fixtures/browser-parity.ts',import.meta.url));
 const built=await build({entryPoints:[entry],bundle:true,platform:'browser',format:'iife',globalName:'Parity',write:false});
 const context=await browser.newContext();await context.route('**/*',route=>route.abort());
 try{
  const page=await context.newPage();await page.setContent('<!doctype html><title>Audio parity</title>');
  await page.addScriptTag({content:built.outputFiles[0]!.text});
  const result=await page.evaluate(async()=>{
   const parity=(window as unknown as {Parity:{run:()=>Promise<Record<string,number>>}}).Parity;
   return parity.run();
  });
  assert.equal(result.shapingCases,14);assert.equal(result.backgroundCases,5);
  t.diagnostic(JSON.stringify(result));
  // Observed same-browser oscillator differences are one float32 ULP (~5.96e-8), not musical changes.
  // -120 dBFS is a strict numerical tolerance; original bytes/samples remain exact.
  assert.ok(result.maxShapingDifference!<=1e-6);assert.ok(result.maxBackgroundDifference!<=1e-6);assert.equal(result.originalDifference,0);
 }finally{await context.close();}
});

async function prepared(mode:'short'|'tail'|'maximum',run:(input:ReturnType<typeof prototypeInput>,sources:Map<string,NormalizedSource>)=>Promise<void>){
 // The real prototype stages bounded media on its disk volume. Using the /tmp
 // RAM tmpfs for all 12 originals + derivatives alone consumed ~200 MiB.
 const scratch=process.env.WANWU_CONTAINER_TEST==='1'?fileURLToPath(new URL('../../../../artifacts/',import.meta.url)):tmpdir();
 const directory=await mkdtemp(join(scratch,'wanwu-render-')),sources=new Map<string,NormalizedSource>();
 try{
  const input=prototypeInput(mode),files=await writePrototypeSources(join(directory,'fixtures'),input),tools=await developmentTools();
  for(const [id,file] of files)sources.set(id,await normalizeSource(file,directory,tools));
  await run(input,sources);
 }finally{for(const source of sources.values())await source.dispose();await rm(directory,{recursive:true,force:true});}
}

test('complete render is real stereo 48k PCM and never mutates the saved input',{timeout:120_000},async t=>{
 await prepared('short',async(input,sources)=>{
  const before=JSON.stringify(input),original=sha256(await readFile(sources.get('source:0')!.path));
  const first=await renderInBrowser(browser,bundle,input,sources),second=await renderInBrowser(browser,bundle,input,sources);
  const pcm=readPcm16Wave(first.wav),metrics=pcmMetrics(pcm.channels);
  assert.equal(pcm.sampleRate,48000);assert.equal(pcm.channels.length,2);assert.equal(metrics.frames,20*48000);
  assert.ok(metrics.peak>0&&metrics.peak<=1);assert.equal(JSON.stringify(input),before);
  const repeated=readPcm16Wave(second.wav);let maximum=0,squared=0,count=0;
  for(let c=0;c<pcm.channels.length;c++)for(let i=0;i<pcm.channels[c]!.length;i++){
   const difference=pcm.channels[c]![i]!-repeated.channels[c]![i]!;maximum=Math.max(maximum,Math.abs(difference));squared+=difference*difference;count++;
  }
  const rmsDifference=Math.sqrt(squared/count);t.diagnostic(JSON.stringify({maximum,rmsDifference}));
  assert.ok(maximum<=1/32768,'repeated renders may differ by at most one PCM16 quantization step');
  assert.ok(rmsDifference<=1e-6,'whole-piece numerical noise must stay below -120 dBFS');
  assert.equal(sha256(await readFile(sources.get('source:0')!.path)),original);
  const sourceBytes=await readFile(sources.get('source:0')!.path),sourcePcm=readPcm16Wave(sourceBytes);
  const facts={'source:0':{checksum:sha256(sourceBytes),analysis:analyseSamples(sourcePcm.channels,sourcePcm.sampleRate)}};
  const verified=readPcm16Wave((await renderInBrowser(browser,bundle,{...input,sourceFacts:facts},sources)).wav);
  let factSquare=0,factCount=0;
  for(let c=0;c<pcm.channels.length;c++)for(let i=0;i<pcm.channels[c]!.length;i++){const difference=pcm.channels[c]![i]!-verified.channels[c]![i]!;factSquare+=difference*difference;factCount++;}
  assert.ok(Math.sqrt(factSquare/factCount)<=1e-6,'hash-bound server analysis must preserve the original renderer output');
 });
});

test('a 45-second sound starting at the 45-second edge keeps its whole 90-second tail',{timeout:180_000},async()=>{
 await prepared('tail',async(input,sources)=>{
  input.settings.background.enabled=false;
  const result=await renderInBrowser(browser,bundle,input,sources),pcm=readPcm16Wave(result.wav);
  assert.equal(pcm.channels[0]!.length,90*48000);
  assert.ok(pcmMetrics([pcm.channels[0]!.slice(-4800)]).rms>.001,'last 100ms must still contain sound');
 });
});

test('12 stereo sources and 24 placements complete sequentially, including combined shaping',{timeout:240_000},async()=>{
 await prepared('maximum',async(input,sources)=>{
  input.arrangement.units=input.arrangement.units.map((unit,i)=>({...unit,shape:i%2?{}:{pitch:'high',duration:'long',contour:'wavy',intensity:'loud',pattern:'bursts'}}));
  input.settings.background.instruments=['inst:local:organ','inst:local:xylophone','inst:local:drum'];
  const result=await renderInBrowser(browser,bundle,input,sources);
  assert.ok((result.metrics.duration as number)>=45&&(result.metrics.duration as number)<=90);
  assert.ok((result.metrics.peak as number)>0&&(result.metrics.peak as number)<=1.01);
 });
});

test('the published frog example is checksum-verified, rendered and encoded without changing its released bytes',{timeout:60_000},async()=>{
 const root=new URL('../../../../',import.meta.url);
 const manifest=JSON.parse(await readFile(new URL('data/catalogue/library-manifest.json',root),'utf8')) as {id:string;path:string;sha256:string;bytes:number}[];
 const frog=manifest.find(item=>item.id==='frog');assert.ok(frog);
 assert.match(frog.path,/^data\/catalogue\/previews\/frog\.[a-f0-9]+\.mp3$/);
 const file=fileURLToPath(new URL(frog.path,root)),released=await readFile(file);
 assert.equal(released.length,frog.bytes);assert.equal(sha256(released),frog.sha256);
 const scratch=process.env.WANWU_CONTAINER_TEST==='1'?fileURLToPath(new URL('artifacts/',root)):tmpdir();
 const directory=await mkdtemp(join(scratch,'wanwu-example-')),tools=await developmentTools();
 try{
  // This is an already-public compressed derivative, not the archival original.
  const source=await normalizeSource(file,directory,tools,frog.sha256);
  try{
   const input=prototypeInput();input.settings.background.enabled=false;
   input.arrangement.events[0]!.clip={startMs:400,endMs:3600};
   const result=await renderInBrowser(browser,bundle,input,new Map([['source:0',source]]));
   const pcm=readPcm16Wave(result.wav),metrics=pcmMetrics(pcm.channels);
   assert.equal(pcm.sampleRate,48000);assert.equal(pcm.channels.length,2);assert.equal(metrics.frames,20*48000);
   assert.ok(metrics.rms>.0001&&metrics.peak>0&&metrics.peak<=1.01);
   const wave=join(directory,'example.wav');await writeFile(wave,result.wav,{flag:'wx'});
   const encoded=await encodeMp3(wave,join(directory,'example.mp3'),tools);
   assert.equal(encoded.codec,'mp3');assert.equal(encoded.sampleRate,48000);assert.equal(encoded.channels,2);
   assert.equal(sha256(await readFile(file)),frog.sha256);
  }finally{await source.dispose();}
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('missing audio and deadlines fail honestly and release the browser context',{timeout:60_000},async()=>{
 const before=browser.contexts().length;
 await assert.rejects(renderInBrowser(browser,bundle,prototypeInput(),new Map()),/missing-source/);
 await prepared('short',async(input,sources)=>{
  await assert.rejects(renderInBrowser(browser,bundle,input,sources,1),/render-timeout/);
 });
 assert.equal(browser.contexts().length,before);
 const servers=()=>process.getActiveResourcesInfo().filter(kind=>kind==='TCPServerWrap').length;
 await browser.close();const beforeServers=servers();
 await assert.rejects(renderInBrowser(browser,bundle,prototypeInput(),new Map()),/closed/i);
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(servers(),beforeServers,'failed browser setup must close the loopback source server too');
});
