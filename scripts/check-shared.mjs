// Confirms the shared packages here are exactly the copy synced from the frontend: every file under
// packages/{contracts,sound-rules,audio-engine,prompts,music-features} matches its fingerprint in handoff/manifest.json,
// none is missing, none is extra, none is a symlink. Part of `npm run build`; `scripts/sync-shared.mjs` writes the list.
// Usage: node scripts/check-shared.mjs
import {lstat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SHARED,files,sha} from './sync-shared.mjs';

export const SCHEMA='wanwu-shared-packages-v1';
const PACKAGE_PATH=new RegExp(`^packages/(?:${SHARED.join('|')})/`);

/** A manifest path that stays inside one shared package. */
function safePath(file){
 return typeof file==='string'
  &&PACKAGE_PATH.test(file)
  &&path.posix.normalize(file)===file
  &&!file.includes('\\')
  &&!file.split('/').includes('..');
}
/** True when any part of the path, from `root` down, is a symlink. */
async function throughSymlink(root,file){
 let current=root;
 for(const part of file.split('/')){
  current=path.join(current,part);
  if((await lstat(current).catch(()=>null))?.isSymbolicLink())return true;
 }
 return false;
}

/** Compares the packages under `root` with its manifest; returns the paths that differ, by kind. */
export async function checkShared(root){
 const manifest=JSON.parse(await readFile(path.join(root,'handoff/manifest.json'),'utf8'));
 if(manifest.schema!==SCHEMA
  ||!Array.isArray(manifest.sharedFiles)
  ||!manifest.sharedFiles.length)throw new Error('Invalid shared-package manifest');
 const expected=new Map();
 for(const entry of manifest.sharedFiles){
  if(!safePath(entry?.path)
   ||!/^[a-f0-9]{64}$/.test(entry.sha256)
   ||expected.has(entry.path))throw new Error('Invalid manifest entry: '+String(entry?.path));
  expected.set(entry.path,entry.sha256);
 }
 const present=[];
 for(const name of SHARED){
  for(const file of await files(path.join(root,'packages',name)).catch(()=>[]))present.push(`packages/${name}/${file}`);
 }
 const result={changed:[],missing:[],extra:[],symlinks:[]};
 for(const file of present){
  if(await throughSymlink(root,file))result.symlinks.push(file);
  else if(!expected.has(file))result.extra.push(file);
  else if(await sha(path.join(root,file))!==expected.get(file))result.changed.push(file);
 }
 result.missing=[...expected.keys()].filter(file=>!present.includes(file));
 return {files:expected.size,...result};
}

export async function main(){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const {files:count,...differences}=await checkShared(root);
 const failed=Object.values(differences).some(list=>list.length);
 if(failed){
  console.error(JSON.stringify({status:'fail',...differences},null,1));
  console.error('Shared packages differ from handoff/manifest.json: change them in the frontend and run scripts/sync-shared.mjs.');
  process.exitCode=1;
  return;
 }
 console.log(JSON.stringify({status:'pass',sharedFiles:count}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
 console.error(error.message);
 process.exitCode=1;
});
