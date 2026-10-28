import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {bundle,digest,safeRelative,inspectFiles} from '../scripts/frontend-handoff.mjs';

test('frontend handoff rejects traversal, secret, backend and Git metadata paths',()=>{
 for(const value of ['../package.json','/tmp/package.json','apps/web/../api/file.ts','apps/web/../../.env','apps/web/.env.local','apps/web/private.pem','apps/web\\src\\x.ts','.env.api','apps/api/src/main.ts','.git/config','apps/web/node_modules/x','apps/web/.secrets/key'])assert.throws(()=>safeRelative(value));
 for(const value of ['package.json','package-lock.json','netlify.toml','apps/web/src/app/App.tsx','packages/contracts/src/api.ts','packages/audio-engine/src/render.ts'])assert.equal(safeRelative(value),value);
});
test('frontend bundle and shared snapshots match committed handoff fingerprints',async()=>{
 const {manifest}=await bundle();assert.ok(manifest.files.length>50);assert.ok(manifest.sharedFiles.length>20);
 assert.equal(manifest.baseCommit,'35000af3005609b6b02356023dba680233d69cd8');
 assert.ok(!manifest.files.some(file=>file.path.includes('cloud-browser')||file.path.startsWith('apps/api')));
});
test('baseline validation detects changed content and missing or conflicting new files',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'wanwu-handoff-'));
 try{
  await writeFile(path.join(dir,'package.json'),'baseline');
  const entries=[{path:'package.json',before:digest('baseline'),after:digest('changed')},{path:'netlify.toml',before:null,after:digest('new')}];
  assert.deepEqual(await inspectFiles(dir,entries,'before'),[]);
  await writeFile(path.join(dir,'package.json'),'unrelated user change');
  assert.deepEqual(await inspectFiles(dir,entries,'before'),['package.json']);
  await writeFile(path.join(dir,'netlify.toml'),'existing config');
  assert.deepEqual(await inspectFiles(dir,entries,'before'),['package.json','netlify.toml']);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('handoff does not follow a frontend directory symlink outside the checkout',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'wanwu-handoff-'));
 try{await mkdir(path.join(dir,'apps'));await symlink(tmpdir(),path.join(dir,'apps/web'));await assert.rejects(inspectFiles(dir,[{path:'apps/web/file',before:null}],'before'),/symlink/);}
 finally{await rm(dir,{recursive:true,force:true});}
});
