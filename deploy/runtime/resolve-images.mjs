import {readFile,writeFile,lstat,realpath,rename,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {releaseManifest,environmentPins,releaseEnvironment,imageKinds,acceptsImage} from './image-pins.ts';

// No pulls, builds, daemon changes or credential reads. Resolve only this release's already loaded images.
const root='/srv/wudaizii/wanwu-sound',run=promisify(execFile);
if(process.platform!=='linux'||process.arch!=='x64'||await realpath(process.cwd())!==root)throw new Error('Only the dedicated Wanwu Linux directory is allowed');
try{
 const manifest=releaseManifest(JSON.parse(await readFile('release-manifest.json','utf8')));
 const current=await lstat('.env.release');if(!current.isFile()||current.isSymbolicLink()||current.mode&0o077)throw new Error('Private regular release environment required');
 environmentPins(await readFile('.env.release','utf8'),manifest);
 const ids={};for(const kind of imageKinds){
  const id=(await run('docker',['image','inspect',manifest.images[kind].tag,'--format','{{.Id}}'],{timeout:15_000})).stdout.trim();
  if(!acceptsImage(manifest.images[kind],id))throw new Error('Loaded image differs from both recorded image/config digests');ids[kind]=id;
 }
 if(!process.argv.includes('--apply')){console.log('Loaded Wanwu digests verified; use --apply only during authorized deployment to update release pins.');}
 else{const temporary=`.release-pins-${randomUUID()}`;
  try{await writeFile(temporary,releaseEnvironment(manifest,ids),{flag:'wx',mode:0o600});await rename(temporary,'.env.release');}
  finally{await rm(temporary,{force:true});}
  console.log('Wanwu release pins resolved without changing Docker or any existing service.');
 }
}catch{console.error('Wanwu image resolution failed; subprocess output suppressed.');process.exitCode=1;}
