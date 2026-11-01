import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {developmentTools} from './devTools.ts';
import {normalizeSource,encodeMp3,sha256} from './media/normalize.ts';
import type {NormalizedSource} from './media/normalize.ts';
import {toolVersions} from './media/tools.ts';
import {browserBundle,openRenderer,renderInBrowser} from './browser/runner.ts';
import {prototypeInput,writePrototypeSources} from './prototype-fixtures.ts';
import type {PrototypeMode} from './prototype-fixtures.ts';

export async function runPrototype(mode:PrototypeMode='short'){
 const root=fileURLToPath(new URL('../../../',import.meta.url)),artifacts=join(root,'artifacts');
 await mkdir(artifacts,{recursive:true});
 const directory=await mkdtemp(join(artifacts,'media-prototype-'));
 const input=prototypeInput(mode),files=await writePrototypeSources(join(directory,'fixtures'),input);
 const tools=await developmentTools(),sources=new Map<string,NormalizedSource>();
 const started=performance.now();
 const {browser,identity}=await openRenderer();
 try{
  for(const [id,file] of files)sources.set(id,await normalizeSource(file,join(directory,'scratch'),tools));
  const result=await renderInBrowser(browser,await browserBundle(),input,sources);
  const wave=join(directory,'mixed.wav'),mp3=join(directory,'mixed.mp3');
  await writeFile(wave,result.wav,{flag:'wx'});
  const encoded=await encodeMp3(wave,mp3,tools);
  const sourceChecksums=[...sources].sort(([a],[b])=>a.localeCompare(b)).map(([sourceId,source])=>({sourceId,
   original:source.sourceChecksum,normalized:source.normalizedChecksum}));
  const inputHash=sha256(Buffer.from(JSON.stringify({input,sourceChecksums})));
  const report={stage:'audio-prototype',mode,status:'local-pass-container-pending',createdAt:new Date().toISOString(),
   workId:input.arrangement.id,sourceKind:mode==='example'?'published-derivative':'synthetic',ruleVersions:input.rules,inputHash,sourceChecksums,
   elapsedMs:Math.round(performance.now()-started),...identity,tools:await toolVersions(tools),render:result.metrics,
   encoded,sha256:sha256(result.wav),sourceCount:sources.size,
   checks:{realAudioRendered:true,realMp3Encoded:true,linuxContainerResourceGate:false,ossIntegration:false},
   artifacts:{wave,mp3}};
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({report:join(directory,'report.json'),...report},null,2));
  return report;
 }finally{
  await browser.close();
  for(const source of sources.values())await source.dispose();
 }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const flag=process.argv[2]??'short';
 if(!['short','tail','maximum','example'].includes(flag))throw new Error('Use: npm run prototype:media -- short|tail|maximum|example');
 await runPrototype(flag as PrototypeMode);
}
